/* eslint-disable @typescript-eslint/no-unused-vars */
// first register ens domain on mainnet
// scripts/deploy.js
import { ethers } from "hardhat"
import { Wallet, providers } from "ethers"
import { config } from "@streamr/config"

import { Operator, OperatorFactory, LinkToken } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")
import * as fs from "fs"
const CHAINURL = config.dev1.rpcEndpoints[0].url
const chainProvider = new providers.JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))
let deploymentOwner: Wallet
let investor: Wallet
let operatorFactory: OperatorFactory
let operator: Operator
let token: LinkToken
const pools: Operator[] = []

const connectToAllContracts = async () => {
    investor = Wallet.createRandom().connect(chainProvider)
    deploymentOwner = new Wallet(localConfig.adminKey, chainProvider)
    await (await deploymentOwner.sendTransaction({
        to: investor.address,
        value: ethers.utils.parseEther("1")
    })).wait()

    log("registering stream registry in streamr config")
    const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", {signer: deploymentOwner })
    const streamrConfigFactoryTx = await streamrConfigFactory.attach(localConfig.streamrConfig)
    const streamrConfig = await streamrConfigFactoryTx.deployed()
    await (await streamrConfig.connect(deploymentOwner).setStreamRegistryAddress(config.contracts.StreamRegistry)).wait()

    const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory", {signer: deploymentOwner })
    const operatorFactoryContact = await operatorFactoryFactory.attach(localConfig.operatorFactory) as OperatorFactory
    operatorFactory = await operatorFactoryContact.connect(deploymentOwner) as OperatorFactory

    const linkTokenFactory = await ethers.getContractFactory("LinkToken", {signer: deploymentOwner })
    const linkTokenFactoryTx = await linkTokenFactory.attach(localConfig.token)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    token = await linkTokenContract.connect(deploymentOwner) as LinkToken

    //send some tokens to investor
    // await (await token.transfer(investor.address, ethers.utils.parseEther("10000"))).wait()

    if (localConfig.pool) {
        operator = await ethers.getContractAt("Operator", localConfig.pool, deploymentOwner) as Operator
        log("Operator loaded from local config: ", operator.address)
    }

    if (localConfig.pools && localConfig.pools.length > 0) {
        for (const pool of localConfig.pools) {
            pools.push(await ethers.getContractAt("Operator", pool, deploymentOwner) as Operator)
        }
    } else {
        localConfig.pools = []
    }
}

const deployOperatorContracts = async (amount: number) => {
    for (let i = 0; i < amount; i++) {
        log("Deploying pool")
        const pooltx = await operatorFactory.connect(deploymentOwner).deployOperator(
            [`Pool-${Date.now()}`, "{}"],
            [localConfig.defaultDelegationPolicy, localConfig.defaultPoolYieldPolicy, localConfig.defaultUndelegationPolicy],
            [0, 0, 0, 0, 0, 0]
        )
        const poolReceipt = await pooltx.wait()
        const operatorAddress = poolReceipt.events?.find((e: any) => e.event === "NewOperator")?.args?.operatorContractAddress
        // eslint-disable-next-line require-atomic-updates
        localConfig.pool = operatorAddress
        log("Pool deployed at: ", operatorAddress)
        operator = await ethers.getContractAt("Operator", operatorAddress, investor) as Operator
        localConfig.pools.push(operatorAddress)
        pools.push(operator)
    }
}

const investToPool = async () => {
    for (const pool of pools) {
        const tx = await token.connect(deploymentOwner).transferAndCall(pool.address, ethers.utils.parseEther("60"),
            investor.address)
        await tx.wait()
        log("Invested to pool ", pool.address)
    }
}

const stakeIntoSponsorship = async () => {
    for (const pool of pools) {
        const tx = await pool.connect(deploymentOwner).stake(localConfig.sponsorship, ethers.utils.parseEther("60"))
        await tx.wait()
        log("Staked into sponsorship from pool ", pool.address)
    }
}

const delegateToPool = async (amount = 50) => {
    log(`Delegate ${amount} tokens to operator ${operator.address} `)
    const amountWei = ethers.utils.parseEther(amount.toString())
    const tx0 = await token.transfer(investor.address, amountWei)
    await tx0.wait()
    const tx = await token.connect(investor).approve(operator.address, amountWei)
    await tx.wait()
    const tx2 = await operator.connect(investor).delegate(amountWei)
    await tx2.wait()
    log("Delegated to operator!")
}

// const divestFromPool = async () => {
//     const tx = await pool.connect(investor).undelegate(ethers.utils.parseEther("1"))
//     await tx.wait()
//     log("Queued data payout")
// }

// const operatorUnstakesFromSponsorship = async () => {
//     const tx = await operator.connect(deploymentOwner).unstake(localConfig.sponsorship)
//     await tx.wait()
//     log("Operator unstaked from sponsorship")
// }

// const flag = async () => {
//     await (await pools[0].connect(deploymentOwner).flag(localConfig.sponsorship, pools[1].address)).wait()
//     // console.log(res)
//     log("Flag: pool ", pools[0].address, " flagged ", pools[1].address)
// }

/** npx hardhat run --network dev1 scripts/tatum/4_deployNewOperator.ts */
async function main() {
    await connectToAllContracts()
    await deployOperatorContracts(1)
    await investToPool()
    await stakeIntoSponsorship()
    // await divestFromPool()
    // await operatorUnstakesFromSponsorship()
    await delegateToPool()
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
    log("Wrote new operator address to local config")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

