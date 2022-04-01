import { JsonRpcProvider } from '@ethersproject/providers'
import { constants, Contract, Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import hhat from 'hardhat'
const { ethers, upgrades } = hhat

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'

let wallet: Wallet 

async function deployDelegatedAccessRegistry() {
    const factory = await ethers.getContractFactory('DelegatedAccessRegistry', wallet)
    const factoryTx = await factory.deploy()
    const dar = await factoryTx.deployed()
    console.log(`DelegatedAccessRegistry deployed at ${dar.address}`)
    return dar.address
}

enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

async function deployERC20JoinPolicy({
    delegatedAccessRegistryAddress, erc20Address, streamId, permissions, minRequiredBalance, streamRegistryAddress
} : {
    delegatedAccessRegistryAddress: string,
    erc20Address: string,
    streamId: string,
    permissions: PermissionType[],
    streamRegistryAddress: string,
    minRequiredBalance: number
}){
    const erc20JoinPolicyFactory = await ethers.getContractFactory('ERC20JoinPolicy', wallet)
    const erc20JoinPolicyFactoryTx = await erc20JoinPolicyFactory.deploy(
        delegatedAccessRegistryAddress,
        erc20Address,
        streamRegistryAddress, //'0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222' --> ConfigTest.streamRegistryChainAddress,
        streamId,
        permissions,
        minRequiredBalance)
    const erc20JoinPolicy = await erc20JoinPolicyFactoryTx.deployed()
    console.log(`ERC20JoinPolicy deployed at ${erc20JoinPolicy.address}`)
}


async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)
    
    const delegatedAccessRegistryAddress = await deployDelegatedAccessRegistry()

    // streamr-docker-dev 
     
        await deployERC20JoinPolicy({
            delegatedAccessRegistryAddress,//: '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222',
            erc20Address: '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
            streamId: '0xa3d1f77acff0060f7213d7bf3c7fec78df847de1/data-join-policy-test',
            permissions: [PermissionType.Publish, PermissionType.Subscribe],
            minRequiredBalance: 1,
            streamRegistryAddress: '0x0D483E10612F327FC11965Fc82E90dC19b141641'
        })

    

    // Polygon Mainnet
    /*
    await deployERC20JoinPolicy({
        delegatedAccessRegistryAddress: '0x52278782360728dC8516253fF0415B5c66f2abd7',
        erc20Address: '0x3a9A81d576d83FF21f26f325066054540720fC34', 
        streamId: '0x2f1418bbe3512156175efa3ef466f40df0161990/streamr-chat/room/erc20-join-policy', 
        permissions: [PermissionType.Publish, PermissionType.Subscribe],
        minRequiredBalance: 1,
        streamRegistryAddress: '0x0D483E10612F327FC11965Fc82E90dC19b141641'
    })
    */

}

main()