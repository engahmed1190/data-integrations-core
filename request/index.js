'use strict';

const { Duplex, } = require('stream');
const AWS = require('aws-sdk');
const convertjson2xml = require('convertjson2xml');
const crypto = require('crypto');
const fs = require('fs-extra');
const https = require('https');
const moment = require('moment');
const path = require('path');
const { URL, } = require('url');
const urlencode = require('urlencode');
const xml2js = require('xml2js');
const periodic = require('periodicjs');
const appConfigLoader = require('@digifi/app-config-loader');

const logger = periodic.logger;

/**
 * Dynamic request parser
 * @param {Object} options Contains dataintegration mongo document and state.
 * @return {Object} Returns fetch options for the api call.
 */
async function parser(options) {
  const { dataintegration, state, } = options;
  const strategy_status = state.strategy_status || 'testing';

  let dir, filename;

  const inputs = await getInputs(options);

  let body = getRequestBody({ inputs, dataintegration, strategy_status });
  body = dataintegration.stringify ? JSON.stringify(body) : body;

  // set dataintegration request options based on active or testing
  const requestOptions = (strategy_status === 'active' && dataintegration.active_request_options)
    ? dataintegration.active_request_options
    : dataintegration.request_options;

  if (inputs) {
    changeRequestOptionsByInputs({ dataintegration, inputs, requestOptions });
  }

  let response_options = dataintegration.response_option_configs || {};

  if (dataintegration.require_security_cert && dataintegration.credentials && dataintegration.credentials.security_certificate) {
    dir = 'security_certificates';
    let Bucket = dataintegration.credentials.security_certificate.attributes.cloudcontainername;
    let Key = dataintegration.credentials.security_certificate.attributes.cloudfilepath;
    let client_encryption_algo = dataintegration.credentials.security_certificate.attributes.client_encryption_algo;
    filename = moment(dataintegration.credentials.security_certificate.createdat).format('YYYY-MM-DD_h:mm:ss_a_')
      + dataintegration.credentials.security_certificate.attributes.original_filename.replace(/\s+/g, '_');

    const securityCertExists = fs.existsSync(path.resolve(dir, filename));

    if (!securityCertExists) {
      await decryptSecurityCert({ Bucket, Key, client_encryption_algo, filename, dir, });
    }
  }
  
  if (dataintegration.request_option_configs) {
    const requestOptionConfigs = dataintegration.request_option_configs;

    if (requestOptionConfigs.set_content_length && requestOptions && requestOptions.headers) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    if (requestOptionConfigs.pfx && requestOptions) {
      requestOptions.pfx = fs.readFileSync(path.resolve(dir, filename));
    }
  }

  if (dataintegration.custom_query_params) {
    const dynamicQueryString = generateDynamicQueryString(
      inputs,
      dataintegration.custom_query_params,
      dataintegration.url_encode_format,
    );

    requestOptions.path += `?${dynamicQueryString}`;
  }

  return {
    requestOptions,
    responseOptions: response_options,
    timeout: dataintegration.timeout,
    body,
  };
}

/**
 * Creates xml body for Corelogic call.
 * @param {Object} options Contains inputs and credit pull config file.
 * @return {Object} Returns xml data for the Corelogic call.
 */
function createBodyXML(options) {
  const { inputs, dataintegration, strategy_status } = options;
  const body = getBodyTemplate(dataintegration, strategy_status);

  if (dataintegration.inputs) {    
    dataintegration.inputs.forEach(config => {
      if (config.traversal_path) {
        let traversal_arr = config.traversal_path.split('.');
        let current_body = body;
        for (let i = 0; i < traversal_arr.length - 1; i++) {
          let elmnt = traversal_arr[ i ];
          current_body = current_body[elmnt];
        }
        current_body[ traversal_arr[ traversal_arr.length - 1 ] ] = formatInputValue({ name: config.input_name, config, inputs, });
      }
    });
  }

  if (dataintegration.xml_library === 'xml2js') {
    const builder = new xml2js.Builder(dataintegration.xml_configs || { 
      "attrkey": '@', 
      "rootName" : "requestTag" 
    });
    return builder.buildObject(body);
  } else {
    const json2xml = convertjson2xml.config(dataintegration.xml_configs || {
      'trim' : true,
      'hideUndefinedTag' : true,
      'nullValueTag' : 'full',
      'emptyStringTag' : 'full',
      'rootTag' : 'requestTag' // should be the root tag of the valid xml that is sent to the 3rd party provider
    });

    return json2xml(body);
  }
}

const getFormattedRequestJSONBody = ({ dataintegration, body }) => {
  if (!dataintegration.formatRequestJSONBody) {
    return body;
  }

  const formatRequest = new Function('body', dataintegration.formatRequestJSONBody);

  return formatRequest.call(null, body);
}

function createJSONBody(options) {
  const { inputs, dataintegration, strategy_status } = options;

  const body = getBodyTemplate(dataintegration, strategy_status);

  if (inputs && dataintegration.inputs) {
    dataintegration.inputs.forEach(config => {
      const formattedInput = formatInputValue({ name: config.input_name, config, inputs });

      inputs[config.input_name] = formattedInput;

      if (config.traversal_path) {
        let traversal_arr = config.traversal_path.split('.');
        let current_body = body;
        for (let i = 0; i < traversal_arr.length - 1; i++) {
          let elmnt = traversal_arr[ i ];
          current_body = current_body[elmnt];
        }

        current_body[traversal_arr[traversal_arr.length - 1]] = typeof formattedInput === 'undefined'
          ? current_body[traversal_arr[traversal_arr.length - 1]]
          : formattedInput;
      } else {
        body[config.input_name] = typeof formattedInput === 'undefined'
          ? body[config.input_name]
          : formattedInput;
      }
    })
  }

  if (dataintegration.custom_inputs) {
    dataintegration.custom_inputs.forEach(config => {
      inputs[ config.name ] = formatInputValue({ name: config.name, config, inputs: dataintegration.custom_inputs, });
    })
  }

  return getFormattedRequestJSONBody({ dataintegration, body });
}

const getRequestBody = ({ dataintegration, inputs, strategy_status }) => {
  if (dataintegration.request_type === 'xml') {
    return createBodyXML({ inputs, dataintegration, strategy_status });
  }

  if (dataintegration.request_type === 'json') {
    return createJSONBody({ inputs, dataintegration, strategy_status });
  }

  if (dataintegration.request_type === 'form-urlencoded') {
    const body = createJSONBody({ inputs, dataintegration, strategy_status });

    return urlencode.stringify(body);
  }

  return null;
}

/**
 * Returns path with params replaced with actual values.
 * 
 * @param {String} path with templates /:example/
 * @param {Object} inputs inputs to use values from
 *
 * @return {String} Returns path with templates replased with input values.
 * 
 */
function generateDynamicPath(path, inputs) {
  return Object.keys(inputs).reduce((newPath, key) => {
    const params = new RegExp(`:${key}`, 'g');

    if (newPath.match(params)) {
      newPath = newPath.replace(params, encodeURIComponent(inputs[key]));
      delete inputs[key];
    }

    return newPath;
  }, path);
}

/**
 * Create buffer stream
 * @param {Buffer} source Buffer to be passed in to convert to stream;
 * @return {Stream} Return stream.
 */
function bufferToStream(source) {  
  if (source instanceof Buffer) {
    const stream = new Duplex();
    stream.push(source);
    stream.push(null);

    return stream;
  }

  return new Error('Input must be a buffer');
}

/**
 * Decrypt security certificate.
 * @param {Object} options Contains location of pfx file, password for file, and type of encryption (i.e. aes256).
 * @return {Object} Returns stream.
 */
async function decryptSecurityCert(options) {
  const { filename, dir, Bucket, Key, client_encryption_algo, } = options;

  const {
    accessKeyId,
    accessKey,
    region,
  } = periodic.settings.extensions['@digifi/periodicjs.ext.packagecloud'].client;
  const s3 = new AWS.S3({ accessKeyId, secretAccessKey: accessKey, region, });

  const encryption_key = periodic.settings.extensions['@digifi-los/reactapp'].encryption_key_path;

  const url = new URL(s3.getSignedUrl('getObject', { Bucket, Key, Expires: 60, }));

  const fetchOptions = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
  };

  const decipher = crypto.createDecipher(client_encryption_algo, encryption_key);

  return new Promise((resolve, reject) => {
    const request = https.request(fetchOptions, response => {
      const data = [];

      response.on('data', chunk => {
        data.push(chunk);
      });

      response.on('error', err => {
        logger.error('response error:', err);
        reject(err);
      });

      response.on('end', async () => {
        try {
          await fs.ensureDir(path.resolve(dir));

          logger.silly('Security certificates directory created!');

          const writeStream = bufferToStream(Buffer.concat(data))
            .pipe(decipher)
            .pipe(fs.createWriteStream(path.resolve(dir, filename)));

          writeStream.on('error', err => {
            reject(err);
          });
          writeStream.on('finish', () => {
            logger.silly('Security certificate was saved!');
            resolve(true);
          });
        } catch (err) {
          logger.error(err);
          reject(err);
        }
      });
    });

    request.on('error', error => {
      logger.error('request error:', error);
      reject(error);
    });

    request.end();
  });
}

/**
 * Get template object to be used for XML POST body structure creation
 * @param {Object} dataIntegration
 * @param {String} strategyStatus
 * @return {Object} Returns object with future structure of XML/JSON body
 */
function getBodyTemplate(dataIntegration, strategyStatus) {
  if (strategyStatus === 'active' && dataIntegration.active_default_configuration) {
    return dataIntegration.active_default_configuration;
  }

  return dataIntegration.default_configuration || {};
}

function generateDynamicQueryString(inputs, queryParams, urlEncodeFormat = 'utf-8') {
  try {
    return Object.keys(queryParams).reduce((dynamicQueryEntries, queryKey) => {
      let queryValue = (inputs[queryKey] !== undefined) ? inputs[queryKey] : queryParams[queryKey];

      if (queryValue || queryValue === false || typeof queryValue === 'number') {
        queryValue = urlencode(queryValue, urlEncodeFormat);
        dynamicQueryEntries.push(`${queryKey}=${queryValue}`);
      }

      return dynamicQueryEntries;
    }, []).join('&');
  } catch(error) {
    return `error=${urlencode(error.message)}`;
  }
}

function formatInputValue(options) {
  const { name, config, inputs, } = options;

  if (config.format) {
    switch (config.format) {
      case 'Date':
        return (inputs[name] && moment(inputs[name]).format(config.style) !== 'Invalid date')
          ? moment(inputs[name]).format(config.style)
          : '';
      case 'Evaluation':
        return eval(config.function);    
      default:
        return inputs[name] || '';
    }
  }

  return inputs[name];
}

/**
 * Returns custom inputs object.
 * 
 * @param {Object[]} options Contains state and array of input objects.
 * @return {Object} Returns object containing input name and value.
 * 
 */
async function getInputs(options) {
  const { dataintegration, state, } = options;

  const allInputs = dataintegration.inputs.reduce((inputs, input) => {
    try {
      inputs[input.input_name] = input.input_type === 'value'
        ? input.input_value
        : state[input.input_variable.title];
    } catch (error) {
      console.log(`cannot retrive ${input.input_name} of ${dataintegration.name}`);
    } finally {
      return inputs;
    }
  }, {});

  if (Array.isArray(dataintegration.secrets)) {
    await Promise.all(dataintegration.secrets.map(async (secret) => {
      allInputs[secret.input_name] = await appConfigLoader.getSecret(secret.secret_key);
    }));
  }

  return allInputs;
}

function changeRequestOptionsByInputs(options) {
  const { dataintegration, inputs, requestOptions } = options;
  const { path_variable, request_bearer_token } = inputs;

  requestOptions.path = generateDynamicPath(requestOptions.path, inputs);

  if (path_variable) {
    requestOptions.path = `${requestOptions.path}/${inputs[path_variable].value}`;
  }

  const headers = getHeadersFromInputs({ dataintegration, inputs });

  if (request_bearer_token) {
    headers['Authorization'] = `Bearer ${request_bearer_token.value}`;
  }

  requestOptions.headers = Object.assign(
    requestOptions.headers,
    headers,
  );
}

function getHeadersFromInputs({ dataintegration, inputs }) {
  return dataintegration.inputs.concat(dataintegration.secrets || [])
    .reduce((headers, input) => {
      if (input.header && inputs[input.input_name]) {
        headers[input.input_name] = inputs[input.input_name];
      }

      return headers;
    }, {});
}


module.exports = {
  parser,
  generateDynamicPath,
  bufferToStream,
  getBodyTemplate,
  generateDynamicQueryString,
  getInputs,
};
