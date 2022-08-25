import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from 'ethers'
import hhat from 'hardhat'
const { ethers } = hhat

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = ''
let wallet: Wallet 

const DelegatedAccessRegistryAddress = '0xB3042ecFC4Ba4ef213A38B1C2541E9234a6189cc'

enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

async function deployJoinPolicyRegistry({
    permissions, streamRegistryAddress
}: {
    permissions: PermissionType[],
    streamRegistryAddress: string,
}){
    const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry', wallet)

    const tx = await JoinPolicyRegistry.deploy(
        streamRegistryAddress,
        permissions,
        DelegatedAccessRegistryAddress
    )

    const instance = await tx.deployed()

    console.log(`JoinPolicyRegistry deployed at ${instance.address}`)

}

async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)
    
    // streamr-docker-dev 
    await deployJoinPolicyRegistry({
        permissions: [PermissionType.Publish, PermissionType.Subscribe],
        streamRegistryAddress: '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'
    })

    // Polygon Mainnet
    /*
    await deployJoinPolicyRegistry({
            permissions: [PermissionType.Publish, PermissionType.Subscribe],
            streamRegistryAddress: '0xB3042ecFC4Ba4ef213A38B1C2541E9234a6189cc'
        })*/

}

main()