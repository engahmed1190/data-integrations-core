'use strict';

const chai = require('chai');
const chaiSpies = require('chai-spies');
const { getOutputs, } = require('../response');

const expect = chai.expect;

chai.use(chaiSpies);

describe('Response functions', () => {
  const dataintegration = {
    outputs: [{
      data_type: 'String',
      api_name: 'a',
      description: 'description',
      output_variable: {
        title: 'thisisastring',
      },
    }, {
      data_type: 'Number',
      api_name: '123',
      description: 'description',
      output_variable: {
        title: 'thisisnull',
      },
    }, {
      data_type: 'Boolean',
      api_name: 'true',
      description: 'description',
      output_variable: {},
    }, {
      data_type: 'Boolean',
      api_name: 'bool',
      description: 'description',
      output_variable: {
        title: 'thisisabool',
      },
    },
    ],
  };

  const api_response = {
    wrapper: {
      a: 'somestring',
      b: 'dont show up',
      c: true,
    },
  };

  const responseTraversalPath = [{
    data_type: 'String',
    api_name: 'a',
    description: 'description',
    traversalPath: 'wrapper.a',
  }, {
    data_type: 'Number',
    api_name: '123',
    description: 'description',
    traversalPath: 'a',
  }, {
    data_type: 'Boolean',
    api_name: 'true',
    description: 'description',
    traversalPath: 'wrapper.b',
  }, {
    data_type: 'Boolean',
    api_name: 'bool',
    description: 'description',
    traversalPath: 'wrapper.c',
  },
  ];

  describe('getOutputs', () => {
    it('maps dataintegration outputs to state correctly', () => {
      const outputs = getOutputs({ dataintegration, api_response, responseTraversalPath, });
      const result = {
        thisisastring: 'somestring',
        thisisnull: null,
        thisisabool: true,
      };

      expect(outputs).to.be.deep.equal(result);
    });
  });
});
