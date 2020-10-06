const numeric = require('numeric');
const moment = require('moment-timezone');
const vm = require('vm');

const buildScript = (configuration) => {
  try {
    let script = configuration.global_functions.reduce((result, global_function) => {
      result += '\t';
      result += `let ${global_function.name} = ${global_function.operation};\r\n\t`;

      return result;
    }, '"use strict";\r\ntry{\r\n');

    script += '\t';
    script += `let main = (${configuration.main.toString()})();\r\n\t`;
    script += '} catch(error){ \r\n\t console.log({ error }); _global.error = error.message \r\n}';

    return script;
  } catch (error) {
    return error;
  }
};


const buildContext = () => {
  const _global = {
    parsed_variables: {},
    error: '',
  };

  return Object.assign({}, { console, moment, numeric, _global });
};


const prepareParser = (state, sandbox, script) => {
  try {
    sandbox = Object.assign({}, sandbox, state);
    const parser = new vm.Script(script);
    vm.createContext(sandbox);

    return { sandbox, parser, };
  } catch (error) {
    return error;
  }
};

module.exports = (configuration, data) => {
  try {
    const state = { json_data: data, };

    const script = buildScript(configuration);
    const context = buildContext(configuration.variables);

    const { sandbox, parser } = prepareParser(state, context, script);

    parser.runInContext(sandbox);

    return sandbox._global.parsed_variables;
  } catch (error) {
    return {};
  }
};
