import { JsonRpcProvider } from '@ethersproject/providers'
import { BigNumber, Wallet } from 'ethers'
import hhat from 'hardhat'
const { ethers } = hhat
import axios from 'axios'

// localsidechain

const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = ''

const JoinPolicyRegistryAddress = '0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF'
const StreamRegistryAddress = '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'
const DelegatedAccessRegistryAddress = '0x1CF4ee3a493f9B07AE9394F78E1407c2682B0e8C'

// polygon 
/*
const chainURL = 'https://polygon-rpc.com'
const privKeyStreamRegistry = process.env.PRIV_KEY || ''

const JoinPolicyRegistryAddress = '0x5Cc79AA4fde8589D3b75f0592A9FA37B032e21fA'
const StreamRegistryAddress = '0x0D483E10612F327FC11965Fc82E90dC19b141641'
const DelegatedAccessRegistryAddress = '0x0143825C65D59CD09F5c896d9DE8b7fe952bc5EB'
*/

let wallet: Wallet 

enum TokenStandard { 
    ERC20 = 'ERC20',
    ERC721 = 'ERC721',
    ERC777 = 'ERC777',
    ERC1155 = 'ERC1155'
}

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

async function deployPolicyDeployer(
    standard: TokenStandard
){
    const policyDeployer = await ethers.getContractFactory(`${standard}PolicyDeployer`, wallet)

    const { maxFeePerGas, maxPriorityFeePerGas } = await getGasStationPrices()

    const tx = await policyDeployer.deploy(
        JoinPolicyRegistryAddress,
        StreamRegistryAddress,
        DelegatedAccessRegistryAddress,
        {
            maxFeePerGas, maxPriorityFeePerGas
    
        }
    )

    const instance = await tx.deployed()

    console.log(`${standard}PolicyDeployer deployed at ${instance.address}`)

}

async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)

    await deployPolicyDeployer(TokenStandard.ERC20)
    await deployPolicyDeployer(TokenStandard.ERC721)
    await deployPolicyDeployer(TokenStandard.ERC777)
    await deployPolicyDeployer(TokenStandard.ERC1155)

}

main()
