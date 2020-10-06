'use strict';

const https = require('https');
const requestParser = require('../request').parser;
const responseFormatter = require('../response').customResponseParser;

/**
 * Get API data.
 * 
 * @param {String} api Name of api.
 * @param {Object} options Contains state, dataintegration file, as well as variables from compiled strategy.
 * @return {Object} Promise that resolves with api results.
 * 
 */
async function getAPIData({ dataintegration, state, segment, input_variables, output_variables, }) {
  try {
    const systemInputVariablesMap = new Map(
      input_variables.map((inputVariable) => [inputVariable._id.toString(), inputVariable])
    );

    const systemOutputVariablesMap = new Map(
      output_variables.map((outputVariable) => [outputVariable._id.toString(), outputVariable])
    );

    const newSegment = JSON.parse(JSON.stringify(segment));

    const dataIntegrationInputsMap = new Map(
      dataintegration.inputs.map((input) => [input.input_name, input])
    );

    const dataIntegrationOutputsMap = new Map(
      dataintegration.outputs.map((output) => [output.api_name, output])
    );

    // generate dataintegration inputs with proper traversal_path
    dataintegration.inputs = newSegment.inputs.reduce((inputs, input) => {
      if (input && input.input_type === 'variable') {
        input.input_variable = systemInputVariablesMap.get(input.input_variable.toString());
      } else {
        input.input_value = input.input_variable;
      }

      const diInput = dataIntegrationInputsMap.get(input.input_name);
      input.traversal_path = input.traversal_path || (diInput && diInput.traversal_path) || '';
      
      inputs.push(input);

      return inputs;
    }, []);

    // generate dataintegration outputs with proper traversalPath and arrayConfigs
    dataintegration.outputs = newSegment.outputs.reduce((outputs, output) => {
      output.output_variable = systemOutputVariablesMap.get(output.output_variable.toString());

      const diOutput = dataIntegrationOutputsMap.get(output.api_name);
      output.traversalPath = output.traversalPath || (diOutput && diOutput.traversalPath) || '';
      output.arrayConfigs = output.arrayConfigs || (diOutput && diOutput.arrayConfigs) || [];

      outputs.push(output);

      return outputs;
    }, []);
    
    const requestOptions = { dataintegration, state, };
    const fetchOptions = await requestParser(requestOptions);
    const { response, status, } = await fetch(fetchOptions);

    return responseFormatter(Object.assign({}, requestOptions, { response, status, }));
  } catch (error) {
    throw new Error(`Cannot get valid response from "${dataintegration.name}" data integration: ${error.message}`);
  }
}


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

  const data = [];

  return new Promise((resolve, reject) => {
    const request = https.request(requestOptions, response => {
      const status = response.statusCode.toString();

      if (!STATUS_REGEXP.test(status) || (!responseOptions.skip_status_message_check && typeof response.statusMessage === 'string' && response.statusMessage.toUpperCase() !== 'OK')) {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
        }

        return reject(Object.assign(new Error(response.statusMessage), { status, }));
      }

      response.on('data', chunk => data.push(chunk));
      response.on('error', error => {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
        }

        reject(error);
      });
      response.on('end', () => {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
        }

        resolve({ response: Buffer.concat(data).toString(), status, });
      });
    });

    request.on('error', reject);

    if (requestOptions.method === 'POST') {
      request.write(body);
    }

    request.end();

    if (typeof timeout === 'number') {
      requestTimeout = setTimeout(() => {
        clearTimeout(requestTimeout);

        request.abort();

        reject(new Error(`Request to ${requestOptions.hostname}${requestOptions.path} was aborted`));
      }, timeout);
    }
  });
}

module.exports = {
  getAPIData,
  fetch,
};
