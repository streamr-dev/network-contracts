const { assert } = require('chai')

const { createRequest } = require('../index')
require('dotenv').config({
    path: './.env'
})

describe('createRequest', () => {
    const jobID = '1'

    context('successful calls', () => {
        const requests = [
            {
                name: 'id not supplied',
                testData: {
                    data: {
                        name: 'data.eth'
                    }
                }
            },
            {
                name: 'get ensname data.eth',
                testData: {
                    id: jobID,
                    data: {
                        name: 'data.eth'
                    }
                }
            }
        ]

        requests.forEach((req) => {
            it(`${req.name}`, (done) => {
                createRequest(req.testData, (statusCode, data) => {
                    assert.equal(statusCode, 200)
                    assert.equal(data.jobRunID, jobID)
                    assert.isNotEmpty(data.data)
                    assert.equal(data.result, '193910316122131101886102384542699093198530376650')
                    done()
                })
            })
        })
    })

    context('error calls', () => {
        const requests = [
            {
                name: 'empty body', testData: {}
            },
            {
                name: 'empty data',
                testData: {
                    data: {}
                }
            },
            {
                name: 'base not supplied',
                testData: {
                    id: jobID,
                    data: {
                        quote: 'USD'
                    }
                }
            },
            {
                name: 'quote not supplied',
                testData: {
                    id: jobID,
                    data: {
                        base: 'ETH'
                    }
                }
            },
            {
                name: 'unknown base',
                testData: {
                    id: jobID,
                    data: {
                        base: 'not_real', quote: 'USD'
                    }
                }
            },
            {
                name: 'unknown quote',
                testData: {
                    id: jobID,
                    data: {
                        base: 'ETH', quote: 'not_real'
                    }
                }
            }
        ]

        requests.forEach((req) => {
            it(`${req.name}`, (done) => {
                createRequest(req.testData, (statusCode, data) => {
                    assert.equal(statusCode, 500)
                    assert.equal(data.jobRunID, jobID)
                    assert.equal(data.status, 'errored')
                    assert.isNotEmpty(data.error)
                    done()
                })
            })
        })
    })
})
