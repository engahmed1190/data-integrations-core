'use strict';

const xml2js = require('xml2js');
const VMParser = require('../parser');
const coerceHelper = require('../helper/coerceHelper');

/**
 * Default response parser.
 * 
 * @param {Object} options Contains dataintegration file, state and api response.
 * @return {Object} Returns formatted response.
 * 
 */
async function customResponseParser(options) {
  try {
    const { segment, response, status, dataintegration} = options;

    const responseTraversalPath = options.responseTraversalPath || options.dataintegration.outputs;

    const parsedResponse = await parseRawData(response, dataintegration);
    const api_response = await traverseResponseRawData(parsedResponse, dataintegration);

    return {
      result: getOutputs({ segment, api_response, responseTraversalPath, dataintegration, }),
      response,
      status,
    };
  } catch (error) {
    throw new Error(`Cannot parse response from "${dataintegration.name}" data integration: ${error.message}`);
  }
}

async function parseRawData(rawData, dataintegration) {
  if (typeof rawData !== 'string') {
    return rawData;
  }

  try {
    return JSON.parse(rawData);
  } catch (error) {
    const xmlParserConfigs = dataintegration && dataintegration.xml_parser_configs || {
      explicitArray: false,
      attrkey: '@',
    };
  
    const customXMLParser = new xml2js.Parser(xmlParserConfigs);
  
    return customXMLParser.parseStringPromise(rawData);
  }
}

async function traverseResponseRawData(parsedResponse, dataintegration) {
  if (!dataintegration || !parsedResponse) {
    return parsedResponse;
  }

  const { raw_data_parse, raw_data_traversal_path, } = dataintegration;

  if (!raw_data_parse || !raw_data_traversal_path) {
    return parsedResponse;
  }

  const traversalPath = raw_data_traversal_path.split('.');

  const traversedResponse = Object.assign({}, parsedResponse);

  let prevPointer = traversedResponse;

  for (let i = 0; i < traversalPath.length; i++) {
    const pathVal = traversalPath[i];
    const nextVal = prevPointer[pathVal];

    if (nextVal === undefined) {
      break;
    }

    if (i === traversalPath.length - 1) {
      prevPointer[pathVal] = await parseRawData(nextVal, dataintegration);
      break;
    }

    prevPointer = nextVal;
  }

  return traversedResponse;
}

/**
 * Returns outputs object for Custom data integrations.
 * 
 * @param {Object} options Contains outputs array, api response, and strategy name.
 * @return {Object} Returns object containing output name and value.
 * 
 */
function getOutputs(options) {
  const { dataintegration, api_response, responseTraversalPath, } = options;

  const responseTraversalPathMap = new Map(
    responseTraversalPath.map((pathEntry) => [pathEntry.api_name, pathEntry.traversalPath]),
  );

  if (dataintegration && dataintegration.vm_parser) {
    api_response[ 'VMParserResult' ] = VMParser(dataintegration.vm_parser, api_response);
  }

  return dataintegration.outputs.reduce((outputs, curr) => {
    try {
      const { api_name, output_variable, } = curr;
      const variable = output_variable.title;

      if (variable) {
        const value = customTraverse(api_response, responseTraversalPathMap.get(api_name), curr.arrayConfigs);
        outputs[variable] = value && coerceHelper.coerceValue(value, curr.data_type) || null;
      }

      return outputs;
    } catch (error) {
      return outputs;
    }
  }, {});
}

/**
 * Traverse a given object.
 * @param {Object} obj Object to be traversed.
 * @param {String} traversePath Path to follow.
 * @return {*} Returns output from traversal.
 */
function customTraverse(obj, traversePath, arrayConfigs = []) {
  return traversePath.split('.').reduce((acc, traversePathElement) => {
    if (Array.isArray(acc) && arrayConfigs.length) {
      if (arrayConfigs[0][traversePathElement] !== undefined) {
        const foundObj = acc.find((obj) => {
          return obj[traversePathElement] === arrayConfigs[0][traversePathElement];
        });

        if (foundObj) {
          arrayConfigs.shift();

          return foundObj;
        }
      } else if (!isNaN(Number(traversePathElement)) && Number(traversePathElement) < acc.length) {
        return acc[traversePathElement];
      }
    }

    if (acc && typeof acc === 'object' && acc[traversePathElement] !== undefined) {
      return acc[traversePathElement];
    }

    return null;
  }, obj);
}

module.exports = {
  customResponseParser,
  getOutputs,
};
