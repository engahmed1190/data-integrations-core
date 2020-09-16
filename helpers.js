'use strict';

const testEnv = process.env.NODE_ENV === 'test';
const https = require('https');
const xml2js = require('xml2js');
const { parseNumbers, parseBooleans, } = xml2js.processors;
const { Duplex, } = require('stream');
const fs = require('fs-extra');
const crypto = require('crypto');
const periodic = testEnv ? null : require('periodicjs');
const logger = testEnv ? { silly: () => { }, } : periodic.logger;
const AWS = require('aws-sdk');
const URL = require('url').URL;
const urlencode = require('urlencode');
const path = require('path');
const moment = require('moment');
const VMParser = require('./parser');

/**
 * Fetch method.
 * 
 * @param {Object} options Object containing hostname, pathname, body, timeout, and method.
 * @return {Object} Returns response.
 * 
 */
function fetch(options) {
  const { requestOptions, body, timeout, responseOptions = {} } = options;
  requestOptions.method = requestOptions.method ? requestOptions.method.toUpperCase() : 'GET';
  const STATUS_REGEXP = /^(2|3)\d{2}$/;
  let requestTimeout;
  try {
    let response = [];
    return new Promise((resolve, reject) => {
      let req = https.request(requestOptions, res => {
        let status = res.statusCode.toString();
        if (!STATUS_REGEXP.test(status) || (!responseOptions.skip_status_message_check && typeof res.statusMessage === 'string' && res.statusMessage.toUpperCase() !== 'OK')) {
          if (requestTimeout) clearTimeout(requestTimeout);
          reject(Object.assign(new Error(res.statusMessage), { status, }));
        } else {
          res.on('data', chunk => response.push(chunk));
          res.on('error', e => {
            if (requestTimeout) clearTimeout(requestTimeout);
            reject(e);
          });
          res.on('end', () => {
            if (requestTimeout) clearTimeout(requestTimeout);
            resolve({ response: Buffer.concat(response).toString(), status, });
          });
        }
      });
      req.on('error', reject);
      if (requestOptions.method === 'POST') req.write(body);
      req.end();
      if (typeof timeout === 'number') {
        requestTimeout = setTimeout(() => {
          clearTimeout(requestTimeout);
          req.abort();
          reject(new Error(`Request to ${requestOptions.hostname}${requestOptions.path} was aborted`));
        }, timeout);
      }
    });
  } catch (e) {
    return e;
  }
}

/**
 * Traverse a given object.
 * @param {Object} obj Object to be traversed.
 * @param {String} traversePath Path to follow.
 * @return {*} Returns output from traversal.
 */
function traverse(obj, traversePath) {
  return traversePath.split('.').reduce((acc, curr) => {
    if (acc && typeof acc === 'object' && acc[ curr ] !== undefined) return acc[ curr ];
    else return null;
  }, obj);
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
 * Promisify version of xml parser.
 * @param {String} response XML string
 * @return {Object} Returns JSON response.
 */
async function promisifyCustomXMLParser(response, xmlParserConfigs) {
  return await new Promise((resolve, reject) => {
    xmlParserConfigs = xmlParserConfigs || {
      explicitArray: false,
      attrkey: '@',
    };
    const customXMLParser = new xml2js.Parser(xmlParserConfigs);
    customXMLParser.parseString(response, (err, result) => {
      if (err) reject(err);
      resolve(result);
    });
  });
}

/**
 * Default response parser.
 * 
 * @param {Object} options Contains dataintegration file, state, api response and responseTraversalPath.
 * @return {Object} Returns formatted response.
 * 
 */
async function customResponseParser(options) {
  let { segment, response, status, responseTraversalPath, dataintegration} = options;
  let api_response;
  const xmlParserConfigs = (dataintegration && dataintegration.xml_parser_configs)? dataintegration.xml_parser_configs : {
    explicitArray: false,
    attrkey: '@',
  };
  if (typeof response === 'string') {
    try {
      api_response = JSON.parse(response);
    } catch (e) {
      api_response = await promisifyCustomXMLParser(response, xmlParserConfigs);
    }
    if (dataintegration && dataintegration.raw_data_parse && dataintegration.raw_data_traversal_path && api_response) {
      const traversalPath = dataintegration.raw_data_traversal_path.split('.');
      let prevPointer = api_response;
      for (let i = 0; i < traversalPath.length; i++) {
        const pathVal = traversalPath[i];
        const nextVal = prevPointer[pathVal];
        if (nextVal === undefined) break;
        if (i === traversalPath.length - 1) {
          let rawDataPointer = null;
          try {
            rawDataPointer = JSON.parse(nextVal);
          } catch(e) {
            rawDataPointer = await promisifyCustomXMLParser(nextVal, xmlParserConfigs);
          }
          prevPointer[pathVal] = rawDataPointer;
          break;
        }
        prevPointer = nextVal;
      }
    }
  } else {
    api_response = response;
  }
  let apiData = getOutputs({ segment, api_response, responseTraversalPath, dataintegration: options.dataintegration });
  return Object.assign({ result: apiData, response, status, });
}

/**
 * Create buffer stream
 * @param {Buffer} source Buffer to be passed in to convert to stream;
 * @return {Stream} Return stream.
 */
function bufferToStream(source) {  
  if (source instanceof Buffer) {
    let stream = new Duplex();
    stream.push(source);
    stream.push(null);
    return stream;
  } else {
    return new Error('Input must be a buffer');
  }
}

/**
 * Decrypt security certificate.
 * @param {Object} options Contains location of pfx file, password for file, and type of encryption (i.e. aes256).
 * @return {Object} Returns stream.
 */
async function decryptSecurityCert(options) {
  let { filename, dir, Bucket, Key, client_encryption_algo, } = options;
  let otherDocsFolderExists = fs.existsSync(path.join(__dirname, 'otherdocs'));
  const otherdocs = otherDocsFolderExists ? require('./otherdocs') : null;
  const credentials = otherDocsFolderExists ? otherdocs.credentials : null;
  const { accessKeyId, accessKey, region, } = testEnv && otherDocsFolderExists ? credentials.client : periodic.settings.extensions[ 'periodicjs.ext.packagecloud' ].client;
  const encryption_key = testEnv && otherDocsFolderExists ? credentials.encryption_key_path : periodic.settings.extensions[ '@digifi-los/reactapp' ].encryption_key_path;
  const s3 = new AWS.S3({ accessKeyId, secretAccessKey: accessKey, region, });
  const decipher = crypto.createDecipher(client_encryption_algo, encryption_key);
  let params = { Bucket, Key, Expires: 60, };
  let url = new URL(s3.getSignedUrl('getObject', params));
  let fetchOptions = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
  };
  let response = [];
  return new Promise((resolve, reject) => {
    let req = https.request(fetchOptions, res => {
      res.on('data', chunk => {
        response.push(chunk);
      });
      res.on('error', err => {
        logger.error('response error:', err);
        reject(err);
      });
      res.on('end', async () => {
        try {
          await fs.ensureDir(path.resolve(dir));
          logger.silly('Security certificates directory created!');
          let writeStream = bufferToStream(Buffer.concat(response)).pipe(decipher).pipe(fs.createWriteStream(path.resolve(dir, filename)));
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
    req.on('error', err => {
      logger.error('request error:', err);
      reject(err);
    });
    req.end();
  });
}

// CUSTOM HELPERS

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
    return Object.keys(queryParams).reduce((acc, queryKey) => {
      let queryVal = (inputs[queryKey] !== undefined) ? inputs[queryKey] : queryParams[queryKey];

      if (queryVal || queryVal === false || typeof queryVal === 'number') {
        queryVal = urlencode(queryVal, urlEncodeFormat);
        acc.push(`${queryKey}=${queryVal}`);
      }

      return acc;
    }, []).join('&');
  } catch(e) {
    return `error=${e.message}`;
  }
}

/**
 * Traverse a given object.
 * @param {Object} obj Object to be traversed.
 * @param {String} traversePath Path to follow.
 * @return {*} Returns output from traversal.
 */
function customTraverse(obj, traversePath, arrayConfigs = []) {
  return traversePath.split('.').reduce((acc, curr) => {
    if (Array.isArray(acc) && arrayConfigs.length) {
      if (arrayConfigs[ 0 ][ curr ] !== undefined) {
        let foundObj = acc.find((obj) => obj[ curr ] === arrayConfigs[ 0 ][ curr ]);
        if (foundObj) {
          arrayConfigs.shift();
          return foundObj;
        }
      } else if (!isNaN(Number(curr)) && Number(curr) < acc.length) return acc[ curr ];
    } else if (acc && typeof acc === 'object' && acc[ curr ] !== undefined) {
      return acc[ curr ];
    }
    return null;
  }, obj);
}

function formatInputValue(options) {
  let { name, config, inputs, } = options;
  if (config.format) {
    switch (config.format) {
    case 'Date':
      return (inputs[name] && moment(inputs[name]).format(config.style) !== 'Invalid date') ? moment(inputs[name]).format(config.style) : '';
    case 'Evaluation':
      return eval(config.function);    
    default:
      return inputs[ name ] || '';
    }
  } else {
    return inputs[ name ];
  }
}

/**
 * Returns outputs object for Custom data integrations.
 * 
 * @param {Object} options Contains outputs array, api response, and strategy name.
 * @return {Object} Returns object containing output name and value.
 * 
 */
function getOutputs(options) {
  let { dataintegration, segment, api_response, responseTraversalPath, } = options;
  responseTraversalPath = responseTraversalPath.reduce((acc, curr) => {
    acc[ curr.api_name ] = curr.traversalPath;
    return acc;
  }, {});
  if (dataintegration && dataintegration.vm_parser) {
    api_response[ 'VMParserResult' ] = VMParser(dataintegration.vm_parser, api_response);
  }
  return dataintegration.outputs.reduce((acc, curr) => {
    try {
      let { api_name, output_variable, } = curr;
      let variable = output_variable.title;
      let value = customTraverse(api_response, responseTraversalPath[ api_name ], curr.arrayConfigs);
      if (variable) acc[ variable ] = (value !== null && value !== undefined) ? coerceValue({ data_type: curr.data_type, value, }) : null;
      return acc;
    } catch (err) {
      return acc;
    }
  }, {});
}

function coerceValue(options) {
  let { data_type, value } = options;
  try {
    switch (data_type) {
    case 'String':
      return (typeof value === 'string') ? value : String(value);
    case 'Number': 
      return (value && !isNaN(Number(value))) ? Number(value) : value;
    case 'Boolean':
      if (typeof value === 'string' && value.toLowerCase() === 'true') {
        value = true;
      } else if (typeof value === 'string' && value.toLowerCase() === 'false') {
        value = false;
      }
      return value;  
    case 'Date':
      return (value && moment(value).format('MM/DD/YYYY') !== 'Invalid date') ? moment(value).format('MM/DD/YYYY') : value;
    default:
      return value;  
    }
  } catch (e) {
    return value;
  }
}

/**
 * Returns custom inputs object.
 * 
 * @param {Object[]} options Contains state and array of input objects.
 * @return {Object} Returns object containing input name and value.
 * 
 */
function getInputs(options) {
  let { dataintegration, state, } = options;
  return dataintegration.inputs.reduce((acc, curr) => {
    try {
      if (curr.input_type === 'value') acc[ curr.input_name ] = curr.input_value;
      else acc[ curr.input_name ] = state[ curr.input_variable.title ];
      return acc;
    } catch (err) {
      return acc;
    }
  }, {});
}

function changeRequestOptionsByInputs(options) {
  const { inputs, request_options } = options;
  const { path_variable, request_bearer_token } = inputs;

  request_options.path = generateDynamicPath(request_options.path, inputs);

  if (path_variable) {
    request_options.path = `${request_options.path}/${inputs[path_variable]}`;
  }

  if (request_bearer_token && request_options.headers) {
    request_options.headers['Authorization'] = `Bearer ${request_bearer_token}`;
  }
}

module.exports = {
  fetch,
  getInputs,
  getOutputs,
  generateDynamicPath,
  getBodyTemplate,
  generateDynamicQueryString,
  formatInputValue,
  customResponseParser,
  decryptSecurityCert,
  promisifyCustomXMLParser,
  traverse,
  bufferToStream,
  changeRequestOptionsByInputs,
};
