// first register ens domain on mainnet
// scripts/deploy.js
import { JsonRpcProvider } from "@ethersproject/providers"
import { ethers } from "hardhat"
import { Wallet } from "ethers"
import { Chains } from "@streamr/config"

import { Operator, OperatorFactory, LinkToken } from "../../typechain"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")
import * as fs from "fs"
const config = Chains.load()["dev1"]
const CHAINURL = config.rpcEndpoints[0].url
const chainProvider = new JsonRpcProvider(CHAINURL)
const localConfig = JSON.parse(fs.readFileSync("localConfig.json", "utf8"))
localConfig.pools = []
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

    const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory", {signer: deploymentOwner })
    const operatorFactoryContact = await operatorFactoryFactory.attach(localConfig.operatorFactory) as OperatorFactory
    operatorFactory = await operatorFactoryContact.connect(deploymentOwner) as OperatorFactory

    const linkTokenFactory = await ethers.getContractFactory("LinkToken", {signer: deploymentOwner })
    const linkTokenFactoryTx = await linkTokenFactory.attach(localConfig.token)
    const linkTokenContract = await linkTokenFactoryTx.deployed()
    token = await linkTokenContract.connect(deploymentOwner) as LinkToken

    //send some tokens to investor
    await (await token.transfer(investor.address, ethers.utils.parseEther("10000"))).wait()

    if (localConfig.pool) {
        operator = await ethers.getContractAt("Operator", localConfig.pool, deploymentOwner) as Operator
    }
}

const deployOperatorContracts = async (amount: number) => {
    for (let i = 0; i < amount; i++) {
        const pooltx = await operatorFactory.connect(deploymentOwner).deployOperator(
            0, // min initial investment
            [`Pool-${Date.now()}`, "{}"],
            [localConfig.defaultDelegationPolicy, localConfig.defaultPoolYieldPolicy, localConfig.defaultUndelegationPolicy],
            [0, 0, 0, 0, 0, 10, 10, 0]
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
        const tx = await token.connect(investor).transferAndCall(pool.address, ethers.utils.parseEther("1000"),
            investor.address)
        await tx.wait()
        log("Invested to pool ", pool.address)
    }
}

const stakeIntoSponsorship = async () => {
    for (const pool of pools) {
        const tx = await pool.connect(deploymentOwner).stake(localConfig.sponsorship, ethers.utils.parseEther("1000"))
        await tx.wait()
        log("Staked into sponsorship from pool ", pool.address)
    }
}

// const divestFromPool = async () => {
//     const tx = await pool.connect(investor).undelegate(ethers.utils.parseEther("1"))
//     await tx.wait()
//     log("Queued data payout")
// }

// const operatorUnstakesFromSponsorship = async () => {
//     const tx = await pool.connect(deploymentOwner).unstake(localConfig.sponsorship)
//     await tx.wait()
//     log("Operator unstaked from sponsorship")
// }

const flag = async () => {
    await (await pools[0].connect(deploymentOwner).flag(localConfig.sponsorship, pools[1].address)).wait()
    // console.log(res)
    log("Flag: pool ", pools[0].address, " flagged ", pools[1].address)
}

async function main() {
    await connectToAllContracts()
    await deployOperatorContracts(3)
    await investToPool()
    await stakeIntoSponsorship()
    await flag()
    // await divestFromPool()
    // await operatorUnstakesFromSponsorship()
    fs.writeFileSync("localConfig.json", JSON.stringify(localConfig, null, 2))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
