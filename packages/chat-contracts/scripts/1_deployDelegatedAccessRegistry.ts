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
const privKeyStreamRegistry =
    process.env.PRIV_KEY || ''
*/
async function main() {
    const wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))

    const DelegatedAccessRegistry = await ethers.getContractFactory(
        'DelegatedAccessRegistry',
        wallet
    )

    const tx = await DelegatedAccessRegistry.deploy()

    const instance = await tx.deployed()

    console.log(`DelegatedAccessRegistry deployed at ${instance.address}`)
}

main()
