/**
 * Reproduction of ETH-802 bug
 * 1) in network-subgraphs, run `npm run docker:buildLocalArch`
 * 2) `streamr-docker-dev start deploy-network-subgraphs-fastchain`
 * 3) Open `http://localhost:8800/subgraphs/name/streamr-dev/network-subgraphs/graphql`
 *      and query `query MyQuery { queueEntries { delegator { id } } }`
 * 4) run this file
 * 5) Run the query again
 *
 * Before fix, it would error out with "Cannot return null for non-nullable field QueueEntry.delegator." or similar
 *
 * TODO: after we have integration tests for real (ETH-639), move this into a proper test
 */

const { Wallet, Contract, providers } = require("ethers")
const { operatorABI } = require('../../../network-contracts/dist/src/exports')

const LARGE_NUMBER = "0x01104d6706312fa73d0e00"

const log = require("debug")("event-queue-test")

async function main() {
    const provider = new providers.JsonRpcProvider("http://10.200.10.1:8547")

    const delegator = new Wallet("0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", provider)
    const nonDelegator = new Wallet("0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", provider)

    const operator = new Contract("0xb63c856cf861a88f4fa8587716fdc4e69cdf9ef1", operatorABI, provider)

    log("Queue before: %o", await operator.undelegationQueue())

    // clog up the undelegation queue
    await operator.connect(delegator).undelegate(LARGE_NUMBER)

    log("Queue after tx 1: %o", await operator.undelegationQueue())

    // this "non-undelegation" won't be processed
    await operator.connect(nonDelegator).undelegate(LARGE_NUMBER)

    log("Queue after tx 2: %o", await operator.undelegationQueue())
}
main().catch(console.error)