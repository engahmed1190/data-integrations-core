'use strict';

const chai = require('chai');
const chaiSpies = require('chai-spies');
const { fetch, } = require('../lib');

const expect = chai.expect;

chai.use(chaiSpies);

describe('Lib functions', () => {
  describe('fetch', () => {
    const getRequest = {
      hostname: 'httpbin.org',
      path: '/get',
      method: 'GET',
    };
    const postRequest = {
      hostname: 'httpbin.org',
      path: '/post',
      method: 'POST',
    };

    const body = JSON.stringify({ test: true, });

    it('can make get request', async () => {
      const requestResponse = await fetch({ requestOptions: getRequest, });
      expect(requestResponse.status).to.be.equal('200');
      expect(requestResponse.status).to.not.equal('404');
    });

    it('can make post request', async () => {
      const postResponse = await fetch({ requestOptions: postRequest, body, });
      const response = JSON.parse(postResponse.response);
      expect(postResponse.status).to.be.equal('200');
      expect(JSON.stringify(response.json)).to.be.equal(body);
    });

    it('will abort request if timeout is provided', async () => {
      try {
        await fetch({ requestOptions: getRequest, timeout: 10, });
        expect(true).to.be.equal(true);
      } catch (e) {
        expect(e).to.be.instanceof(Error);
        expect(e.message).to.be.equal('Request to httpbin.org/get was aborted');
      }
    });
  });
});
