/* eslint-disable promise/no-callback-in-promise */
const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')
const { ethers } = require('ethers')
const namehash = require('eth-ens-namehash')
const { Requester, Validator } = require('@chainlink/external-adapter')

// const provider = new ethers.providers.InfuraProvider(process.env.NETWORK, process.env.INFURA_API_KEY)
const provider = new ethers.providers.JsonRpcProvider(process.env.LOCAL_PARITY_MAINCHAIN)

const customParams = {
    name: ['name', 'ensname']
}

const createRequest = (input, callback) => {
    const validator = new Validator(input, customParams)
    const jobRunID = validator.validated.id

    const ensContract = new ethers.Contract(process.env.ENS_CONTRACT_ADDRESS, ensAbi.abi, provider)
    const ensHashedName = namehash.hash(validator.validated.data.name)
    ensContract.owner(ensHashedName)
        .then((res) => {
            // hex number to decimal to string of decimal
            const resint = BigInt(res).toString()
            return callback(200, Requester.success(jobRunID, {
                data: {
                    result: resint
                }
            }))
        })
        .catch((error) => {
            callback(500, Requester.errored(jobRunID, error, 500))
        })
}

// This is a wrapper to allow the function to work with
// GCP Functions
exports.gcpservice = (req, res) => {
    createRequest(req.body, (statusCode, data) => {
        res.status(statusCode).send(data)
    })
}

// This is a wrapper to allow the function to work with
// AWS Lambda
exports.handler = (event, context, callback) => {
    createRequest(event, (statusCode, data) => {
        callback(null, data)
    })
}

// This is a wrapper to allow the function to work with
// newer AWS Lambda implementations
exports.handlerv2 = (event, context, callback) => {
    createRequest(JSON.parse(event.body), (statusCode, data) => {
        callback(null, {
            statusCode,
            body: JSON.stringify(data),
            isBase64Encoded: false
        })
    })
}

module.exports.createRequest = createRequest
