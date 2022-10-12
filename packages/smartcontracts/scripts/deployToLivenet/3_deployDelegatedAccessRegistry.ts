import { JsonRpcProvider } from '@ethersproject/providers'
import { BigNumber, Wallet } from 'ethers'
import hhat from 'hardhat'
const { ethers } = hhat
import axios from 'axios'

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = ''

async function getGasStationPrices(): Promise<{maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber}> {
    const { data } = await axios({
        method: 'get',
        url: 'https://gasstation-mainnet.matic.network/v2'
    })
    const maxFeePerGas = ethers.utils.parseUnits(
        Math.ceil(data.fast.maxFee) + '',
        'gwei'
    )
    const maxPriorityFeePerGas = ethers.utils.parseUnits(
        Math.ceil(data.fast.maxPriorityFee) + '',
        'gwei'
    )

    return { maxFeePerGas, maxPriorityFeePerGas }
}

async function main() {
    const wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))

    const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry', wallet)

    const { maxFeePerGas, maxPriorityFeePerGas } = await getGasStationPrices()

    const tx = await DelegatedAccessRegistry.deploy({
        maxFeePerGas, maxPriorityFeePerGas
    })

    const instance = await tx.deployed()

    console.log(`DelegatedAccessRegistry deployed at ${instance.address}`)

}

main()