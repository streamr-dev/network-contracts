import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from 'ethers'
import hhat from 'hardhat'
const { ethers } = hhat

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = ''
/*
// polygon
const chainURL = 'https://polygon-rpc.com'
const privKeyStreamRegistry = process.env.KEY || ''
*/

let wallet: Wallet

async function deployJoinPolicyRegistry() {
    const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry', wallet)

    const tx = await JoinPolicyRegistry.deploy()

    const instance = await tx.deployed()

    console.log(`JoinPolicyRegistry deployed at ${instance.address}`)
}

async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)

    await deployJoinPolicyRegistry()
}

main()
