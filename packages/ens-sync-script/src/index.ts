/* eslint-disable no-console */
import { ethers, providers } from 'ethers'
import { Chains } from "@streamr/config"
// import * as ABIenscache from "../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const ABIenscache = require("../../network-contracts/artifacts/contracts/chainlinkClient/ENSCacheV2Streamr.sol/ENSCacheV2Streamr.json")

async function main(){
    const config = Chains.load()["dev1"]

    // const provider = new providers.WebSocketProvider(
    //     `wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
    // );

    const provider = new providers.JsonRpcProvider(
        // `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`
        config.rpcEndpoints[0].url
    )

    const contract = new ethers.Contract(config.contracts.StreamRegistry, ABIenscache.abi, provider)
    console.log("test1")
    contract.on("RequestENSOwnerAndCreateStream", (from, to, value, event)=>{
        // let transferEvent ={
        //     from: from,
        //     to: to,
        //     value: value,
        //     eventData: event,
        // }
        console.log("### event cought: " + JSON.stringify(event))
    })
}

main().then(() => {
    // debug('done')
    console.log("done")
    return void 0
}).catch((err: any) => {
    console.log("error: " + err)
    // connection.end()
    // debug('err: ' + err)
})