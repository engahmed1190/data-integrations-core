'use strict';

const chai = require('chai');
const chaiSpies = require('chai-spies');
const {
  getInputs,
  getBodyTemplate,
  generateDynamicQueryString,
  generateDynamicPath,
  bufferToStream,
} = require('../request');

const { Duplex, } = require('stream');

const expect = chai.expect;

chai.use(chaiSpies);

describe('Request functions', () => {
  describe('getInputs', () => {
    it('maps dataintegration inputs to state correctly', () => {
      const inputs = getInputs({
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

      const result = {
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
    };

    it('returns active_default_configuration if strategy is in active status', () => {
      const bodyTemplate = getBodyTemplate(dataIntegration, 'active');

      expect(bodyTemplate).to.be.equal(dataIntegration.active_default_configuration);
    });

    it('returns default_configuration if strategy is in testing status', () => {
      const bodyTemplate = getBodyTemplate(dataIntegration, 'testing');

      expect(bodyTemplate).to.be.equal(dataIntegration.default_configuration);
    });

    it('returns empty object when there are no configurations in dataintegration', () => {
      const bodyTemplate = getBodyTemplate({}, 'testing');

      expect(bodyTemplate).to.be.an('object').and.be.empty;
    });
  });

  describe('generateDynamicQueryString', () => {
    it('formats custom query using inputs', () => {
      const query = generateDynamicQueryString({name: 'Replace'}, {name: 'Test'});

      expect(query).to.be.eql('name=Replace');
    });

    it('uses default query param value if there is no input for that param', () => {
      const query = generateDynamicQueryString({}, {name: 'Test'});

      expect(query).to.be.eql('name=Test');
    });

    it('urlencodes inputs', () => {
      const query = generateDynamicQueryString({}, {name: 'Test Name'});

      expect(query).to.be.eql('name=Test%20Name');
    });

    it('skips null, empty string, undefined inputs without default query param value', () => {
      const query = generateDynamicQueryString(
        {},
        { name: '', surname: undefined, address: null, test: false, count: 0 },
      );

      expect(query).to.be.eql('test=false&count=0');
    });
  });

  describe('generateDynamicPath', () => {
    it('replaces templates in path', () => {
      const path = 'www.exampleurl.com/:id/:date';
      const inputs = {
        id: 123,
        date: '2019',
      };

      const newURL = generateDynamicPath(path, inputs);
      const result = 'www.exampleurl.com/123/2019';

      expect(newURL).to.be.equal(result);
    });

    it('not replaces templates if there is no such input', () => {
      const path = 'www.exampleurl.com/:id/:date';
      const inputs = {};

      const newURL = generateDynamicPath(path, inputs);

      expect(newURL).to.be.equal(path);
    });
  });

  describe('bufferToStream', () => {
    it('checks input is a buffer', () => {
      const error = bufferToStream('test');

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.be.equal('Input must be a buffer');
    });

    it('returns a stream', () => {
      const stream = bufferToStream(Buffer.from([ 'test', ]));

      expect(stream).to.be.instanceOf(Duplex);
    });
  });
});
