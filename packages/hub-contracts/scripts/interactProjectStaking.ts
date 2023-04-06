import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet, providers } from "ethers"
import { Chains } from "@streamr/config"
import { DATAv2, ProjectStakingV1 } from "../typechain"

const { getContractFactory } = hardhatEthers
const { log } = console

const {
    CHAIN = 'polygon',
    KEY: STAKER_KEY = "", // PASTE PRIVATE KEY HERE or `export KEY=...` as env var
} = process.env

if (!STAKER_KEY) { throw new Error(`No staker key found in chain "${CHAIN}"`) }

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: STAKING_TOKEN,
        ProjectStakingV1: PROJECT_STAKING_ADDRESS,
    }
} = Chains.load()[CHAIN]

let projectStaking: ProjectStakingV1
let stakingToken: DATAv2
let buyerWallet: Wallet

const connectWallets = () => {
    const provider = new providers.JsonRpcProvider(ETHEREUM_RPC_URL)
    buyerWallet = new Wallet(STAKER_KEY, provider)
}

const connectContracts = async () => {
    const stakingTokenFactory = await getContractFactory("DATAv2")
    const stakingTokenFactoryTx = await stakingTokenFactory.attach(STAKING_TOKEN)
    stakingToken = await stakingTokenFactoryTx.deployed() as DATAv2
    log("Staking token address: ", stakingToken.address)

    const projectStakingFactory = await getContractFactory("ProjectStakingV1")
    const projectStakingFactoryTx = await projectStakingFactory.attach(PROJECT_STAKING_ADDRESS)
    projectStaking = await projectStakingFactoryTx.deployed() as ProjectStakingV1
    log("ProjectStakingV1 deployed at: ", projectStaking.address)
}

const options = async (maxFee = "400", maxPriorityFee = "200") => {
    const gasPrice = (await hardhatEthers.provider.getGasPrice()).toString()
    log(`Current gas price: ${utils.formatUnits(gasPrice, "gwei")}`)

    return {
        maxPriorityFeePerGas: utils.parseUnits(maxPriorityFee, "gwei"),
        maxFeePerGas: utils.parseUnits(maxFee, "gwei"),
        gasLimit: 2000000,
    }
}

const approve = async (amountToStake: number) => {
    const amountToStakeWei = utils.parseEther(amountToStake.toString())
    log(`Approving ${amountToStake} tokens to be spent by the project staking:`)
    const tx = await stakingToken.connect(buyerWallet).approve(projectStaking.address, amountToStakeWei, await options())
    log(`Approve tx:`, tx.hash)
    await tx.wait()
}

const stake = async (projectId: string, amountToStake: number) => {
    const amountToStakeWei = utils.parseEther(amountToStake.toString())
    log(`Staking ${amountToStake} tokens to project ${projectId}:`)

    log(`Stake before staking: ${await projectStaking.getProjectStake(projectId)}`)
    const tx = await projectStaking.connect(buyerWallet).stake(projectId, amountToStakeWei, await options())
    log(`Stake tx:`, tx.hash)
    await tx.wait()
    log(`Stake after staking: ${await projectStaking.getProjectStake(projectId)}`)
}

const unstake = async (projectId: string, amountToUnstake: number) => {
    const amountToUnstakeWei = utils.parseEther(amountToUnstake.toString())
    log(`Unstaking ${amountToUnstake} tokens from project ${projectId}:`)

    log(`Stake before unstaking: ${await projectStaking.getProjectStake(projectId)}`)
    const tx = await projectStaking.connect(buyerWallet).unstake(projectId, amountToUnstakeWei, options)
    log(`Unstake tx: `, tx.hash)
    await tx.wait()
    log(`Stake after unstaking: ${await projectStaking.getProjectStake(projectId)}`)
}

/**
 * npx hardhat run --network polygon scripts/interactProjectStaking.ts
 */
async function main() {
    const projectId = '' // PASTE PROJECT ID HERE
    const amountToStake = 1 // token amount (not wei)
    const amountToUnstake = 1 // token amount (not wei)

    connectWallets()
    await connectContracts()

    await approve(amountToStake)
    await stake(projectId, amountToStake)
    await unstake(projectId, amountToUnstake)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
