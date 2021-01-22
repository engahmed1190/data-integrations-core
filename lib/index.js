'use strict';

const helpers = require('../helpers');
const requestParser = require('../request');
const responseFormatter = require('../response');

/**
 * Get API data.
 * 
 * @param {String} api Name of api.
 * @param {Object} options Contains state, dataintegration file, as well as variables from compiled strategy.
 * @return {Object} Promise that resolves with api results.
 * 
 */
async function getAPIData(options) {
  let { dataintegration, state, segment, input_variables, output_variables, } = options;
  // system input variables map
  // Input variable of the module can be an output variable of the previous module in the strategy.
  // We need to pull its value as well
  const input_var = [...input_variables, ...output_variables].reduce((acc, curr) => {
    acc[ curr._id.toString() ] = curr;
    return acc;
  }, {});
  // system output variables map
  const output_var = output_variables.reduce((acc, curr) => {
    acc[ curr._id.toString() ] = curr;
    return acc;
  }, {});
  const newSegment = JSON.parse(JSON.stringify(segment));
  // create base dataintegration inputs map for initial input configs (e.g. traversal_path)
  const diInputsMap = dataintegration.inputs.reduce((acc, input, i) => {
    acc[ input.input_name ] = input;
    return acc;  
  }, {})
  // create base dataintegration outputs map for initial output configs (e.g. traversalPath, arrayConfigs)
  const diOutputsMap = dataintegration.outputs.reduce((acc, output, i) => {
    acc[ output.api_name ] = output;
    return acc;  
  }, {})

  // generate dataintegration inputs with proper traversal_path
  dataintegration.inputs = newSegment.inputs.reduce((aggregate, inp, i) => {
    const diInput = diInputsMap[ inp.input_name ];
    if (inp && inp.input_type === 'variable') {
      inp.input_variable = input_var[ inp.input_variable.toString()];
    } else {
      inp.input_value = inp.input_variable;
    }

    inp.traversal_path = (inp.traversal_path)
      ? inp.traversal_path
      : (diInput && diInput.traversal_path)
        ? diInput.traversal_path
        : '';
    
    aggregate.push(inp);
    return aggregate;
  }, []);

  // generate dataintegration outputs with proper traversalPath and arrayConfigs
  dataintegration.outputs = newSegment.outputs.reduce((aggregate, out, i) => {
    const diOutput = diOutputsMap[ out.api_name ];
    out.output_variable = output_var[ out.output_variable.toString() ];
    
    out.traversalPath = (out.traversalPath)
      ? out.traversalPath
      : (diOutput && diOutput.traversalPath)
        ? diOutput.traversalPath
        : '';
    
    out.arrayConfigs = (out.arrayConfigs)
      ? out.arrayConfigs
      : (diOutput && diOutput.arrayConfigs)
        ? diOutput.arrayConfigs
        : [];

    aggregate.push(out);
    return aggregate;
  }, []);
  
  options = { dataintegration, state, };
  let fetchOptions = await requestParser(options);
  let { response, status, } = await helpers.fetch(fetchOptions);
  return await responseFormatter(Object.assign({}, options, { response, status, }));
}

module.exports = getAPIData;