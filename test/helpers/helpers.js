'use strict';

const chai = require('chai');
const expect = chai.expect;
const helpers = require('../../helpers.js');
const convertjson2xml = require('convertjson2xml');
const { Duplex, } = require('stream');
const fs = require('fs-extra');

chai.use(require('chai-spies'));

describe('Helper functions', () => {
  describe('fetch', () => {
    let getRequest = {
      hostname: 'httpbin.org',
      path: '/get',
      method: 'GET',
    };
    let postRequest = {
      hostname: 'httpbin.org',
      path: '/post',
      method: 'POST',
    };
    let body = JSON.stringify({ test: true, });
    it('can make get request', async () => {
      let requestResponse = await helpers.fetch({ requestOptions: getRequest, });
      expect(requestResponse.status).to.be.equal('200');
      expect(requestResponse.status).to.not.equal('404');
    });
    it('can make post request', async () => {
      let postResponse = await helpers.fetch({ requestOptions: postRequest, body, });
      let response = JSON.parse(postResponse.response);
      expect(postResponse.status).to.be.equal('200');
      expect(JSON.stringify(response.json)).to.be.equal(body);
    });
    it('will abort request if timeout is provided', async () => {
      try {
        await helpers.fetch({ requestOptions: getRequest, timeout: 10, });
        expect(true).to.be.equal(true);
      } catch (e) {
        expect(e).to.be.instanceof(Error);
        expect(e.message).to.be.equal('Request to httpbin.org/get was aborted');
      }
    });
  });
  describe('getInputs', () => {
    it('maps dataintegration inputs to state correctly', () => {
      let inputs = helpers.getInputs({
        dataintegration: {
          inputs: [
            {
              input_name: 'test1',
              input_type: 'value',
              input_value: 2,
              input_variable: {
                title: 'system_variable_1',
              },
            }, {
              input_name: 'test2',
              input_type: 'variable',
              input_variable: {
                title: 'system_variable_2',
              },
            }, {
              input_name: 'thirdTest',
              input_type: 'variable',
            }, {
              input_name: 'fourthTest',
              input_type: 'value',
            },
          ],
        },
        state: {
          system_variable_1: 'xyz',
          system_variable_2: 'abc',
          system_variable_3: 123,
          system_variable_4: 456,
          input: true,
        },
      });
      let result = {
        test1: 2,
        test2: 'abc',
        fourthTest: undefined,
      };
      expect(inputs).to.be.deep.equal(result);
    });
  });
  describe('getBodyTemplate', () => {
    const dataIntegration = {
      active_default_configuration: { active: true, },
      default_configuration: { active: false, },
    }
    it('returns active_default_configuration if strategy is in active status', () => {
      const bodyTemplate = helpers.getBodyTemplate(dataIntegration, 'active');

      expect(bodyTemplate).to.be.equal(dataIntegration.active_default_configuration);
    });
    it('returns default_configuration if strategy is in testing status', () => {
      const bodyTemplate = helpers.getBodyTemplate(dataIntegration, 'testing');

      expect(bodyTemplate).to.be.equal(dataIntegration.default_configuration);
    });
    it('returns empty object when there are no configurations in dataintegration', () => {
      const bodyTemplate = helpers.getBodyTemplate({}, 'testing');

      expect(bodyTemplate).to.be.an('object').and.be.empty;
    });
  });
  describe('generateDynamicQueryString', () => {
    it('formats custom query using inputs', () => {
      const query = helpers.generateDynamicQueryString({name: 'Replace'}, {name: 'Test'});

      expect(query).to.be.eql('name=Replace');
    });
    it('uses default query param value if there is no input for that param', () => {
      const query = helpers.generateDynamicQueryString({}, {name: 'Test'});

      expect(query).to.be.eql('name=Test');
    });
    it('urlencodes inputs', () => {
      const query = helpers.generateDynamicQueryString({}, {name: 'Test Name'});

      expect(query).to.be.eql('name=Test%20Name');
    });
    it('skips null, empty string, undefined inputs without default query param value', () => {
      const query = helpers.generateDynamicQueryString(
        {},
        { name: '', surname: undefined, address: null, test: false, count: 0 },
      );

      expect(query).to.be.eql('test=false&count=0');
    });
  });
  describe('traverse', () => {
    it('traverses an object based on string path provided', () => {
      let obj = {
        a: [
          1,
          {
            path: true,
          },
        ],
      };
      let output = helpers.traverse(obj, 'a.1.path');
      expect(output).to.be.equal(true);
    });
  });
  let dataintegration = {
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
  let api_response = {
    wrapper: {
      a: 'somestring',
      b: 'dont show up',
      c: true,
    },
  };
  let responseTraversalPath = [{
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
      let outputs = helpers.getOutputs({ dataintegration, api_response, responseTraversalPath, });
      let result = {
        thisisastring: 'somestring',
        thisisnull: null,
        thisisabool: true,
      };
      expect(outputs).to.be.deep.equal(result);
    });
  });
  describe('generateDynamicPath', () => {
    it('replaces templates in path', () => {
      const path = 'www.exampleurl.com/:id/:date';
      const inputs = {
        id: 123,
        date: '2019',
      };

      const newURL = helpers.generateDynamicPath(path, inputs);
      const result = 'www.exampleurl.com/123/2019';

      expect(newURL).to.be.equal(result);
    });

    it('not replaces templates if there is no such input', () => {
      const path = 'www.exampleurl.com/:id/:date';
      const inputs = {};

      const newURL = helpers.generateDynamicPath(path, inputs);

      expect(newURL).to.be.equal(path);
    });
  });
  describe('bufferToStream', () => {
    it('checks input is a buffer', () => {
      let error = helpers.bufferToStream('test');
      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.be.equal('Input must be a buffer');
    });
    it('returns a stream', () => {
      let stream = helpers.bufferToStream(Buffer.from([ 'test', ]));
      expect(stream).to.be.instanceOf(Duplex);
    });
  });
});