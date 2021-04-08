const ensAbi = require('@ensdomains/ens/build/contracts/ENS.json')
const { ethers } = require('ethers')
const namehash = require('eth-ens-namehash')

const { Requester, Validator } = require('@chainlink/external-adapter')

// TODO change to process env
const provider = new ethers.providers.InfuraProvider('rinkeby', 'f39345d630524f63af651ecb5c94f1d6')
const ensAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'

// Define custom error scenarios for the API.
// Return true for the adapter to retry.
// const customError = (data) => {
//   if (data.Response === 'Error') return true
//   return false
// }

// Define custom parameters to be used by the adapter.
// Extra parameters can be stated in the extra object,
// with a Boolean value indicating whether or not they
// should be required.
const customParams = {
  name: ['name', 'ensname']
}

const createRequest = (input, callback) => {
  // The Validator helps you validate the Chainlink request data
  const validator = new Validator(input, customParams)
  const jobRunID = validator.validated.id
  // const endpoint = validator.validated.data.endpoint || 'price'
  // const url = `https://min-api.cryptocompare.com/data/${endpoint}`
  // const fsym = validator.validated.data.base.toUpperCase()
  // const tsyms = validator.validated.data.quote.toUpperCase()

  // const params = {
  //   fsym,
  //   tsyms
  // }

  // This is where you would add method and headers
  // you can add method like GET or POST and add it to the config
  // The default is GET requests
  // method = 'get'
  // headers = 'headers.....'
  // const config = {
  //   url,
  //   params
  // }

  // The Requester allows API calls be retry in case of timeout
  // or connection failure

  const ensContract = new ethers.Contract(ensAddress, ensAbi.abi, provider)
  const ensHashedName = namehash.hash(validator.validated.data.name)
  ensContract.owner(ensHashedName)
  // ensContract.owner(validator.validated.data.name)
    .then(res => {
      // hex number to decimal to string of decimal
      const resint = BigInt(res).toString()
      callback(200, Requester.success(jobRunID, { data: { result: resint } }))
    })

  // provider.resolveName(validator.validated.data.name)
  //   .then(res => {
  //     // console.log("#########", res)
  //     // convert address to bigint, then to string of decimal
  //     const resint = BigInt(res).toString()

  //     callback(200, Requester.success(jobRunID, { data: { result: resint } }))
  //   })

  // Requester.request(config, customError)
  //   .then(response => {
  //     // It's common practice to store the desired value at the top-level
  //     // result key. This allows different adapters to be compatible with
  //     // one another.
  //     response.data.result = Requester.validateResultNumber(response.data, [tsyms])
  //     callback(response.status, Requester.success(jobRunID, response))
  //   })
  //   .catch(error => {
  //     callback(500, Requester.errored(jobRunID, error))
  //   })
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
      statusCode: statusCode,
      body: JSON.stringify(data),
      isBase64Encoded: false
    })
  })
}

// This allows the function to be exported for testing
// or for running in express
module.exports.createRequest = createRequest
