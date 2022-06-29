import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from 'ethers'
import hhat from 'hardhat'
const { ethers } = hhat

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'

async function main() {
    const wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))

    const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry', wallet)

    const tx = await DelegatedAccessRegistry.deploy()

    const instance = await tx.deployed()

    console.log(`DelegatedAccessRegistry deployed at ${instance.address}`)

}

main()