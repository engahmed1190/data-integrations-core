const numeric = require('numeric');
const moment = require('moment-timezone');
const vm = require('vm');

var buildScript = function (configuration) {
  try {
    let script = configuration.global_functions.reduce((result, global_function) => {
      result += '\t';
      result += `let ${global_function.name} = ${global_function.operation};\r\n\t`;
      return result;
    }, '"use strict";\r\ntry{\r\n');
    let mainFn = configuration.main;
    script += '\t';
    script += `let main = (${mainFn.toString()})();\r\n\t`;
    script += '} catch(e){ \r\n\t console.log({e}); _global.error = e.message \r\n}';
    return script;
  } catch (e) {
    return e;
  }
};


var buildContext = function (variables) {
  let _global = {
    parsed_variables: {},
    error: '',
  };
  return Object.assign({}, { console, moment, numeric, _global });
};


var prepareParser = function (state, sandbox, script) {
  try {
    sandbox = Object.assign({}, sandbox, state);
    let parser = new vm.Script(script);
    vm.createContext(sandbox);
    return { sandbox, parser, };
  } catch (e) {
    return e;
  }
};

module.exports = function (configuration, data) {
  try {
    let script = buildScript(configuration);
    let _state = { json_data: data, };
    let _context = buildContext(configuration.variables);
    let { sandbox, parser } = prepareParser(_state, _context, script);
    parser.runInContext(sandbox);
    let result = sandbox._global.parsed_variables;
    return result;
  } catch (e) {
    return {};
  }
};