// first register ens domain on mainnet
// scripts/deploy.js
import fs from "fs"
import { ethers } from "hardhat"

import { config } from "@streamr/config"
import { deployOperatorFactory } from "../deployOperatorFactory"

const CHAINURL = config.dev1.rpcEndpoints[0].url
const chainProvider = new ethers.providers.JsonRpcProvider(CHAINURL)

/** npx hardhat run --network dev1 scripts/tatum/3_deployOperatorFactory.ts */
async function main() {
    const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))
    const deploymentOwner = new ethers.Wallet(localConfig.adminKey, chainProvider)
    const contracts = await deployOperatorFactory(deploymentOwner, localConfig.tokenAddress, localConfig.streamrConfigAddress)
    localConfig.defaultDelegationPolicy = contracts.defaultDelegationPolicy.address
    localConfig.defaultExchangeRatePolicy = contracts.defaultExchangeRatePolicy.address
    localConfig.defaultUndelegationPolicy = contracts.defaultUndelegationPolicy.address
    localConfig.operatorFactory = contracts.operatorFactory.address

    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
    console.log("Wrote operator factory and related contracts to local config")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
