import { JsonRpcProvider } from '@ethersproject/providers'
import { constants, Contract, Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import hhat from 'hardhat'
const { ethers, upgrades } = hhat

// localsidechain
const chainURL = 'http://10.200.10.1:8546'
const privKeyStreamRegistry = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
let wallet: Wallet 

enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

async function deployERC20JoinPolicyRegistry({
    permissions, streamRegistryAddress
} : {
    permissions: PermissionType[],
    streamRegistryAddress: string,
}){
    const ERC20JoinPolicyRegistry = await ethers.getContractFactory('ERC20JoinPolicyRegistry', wallet)

    const tx = await ERC20JoinPolicyRegistry.deploy(
        streamRegistryAddress,
        permissions
    )

    const instance = await tx.deployed()

    console.log(`ERC20JoinPolicyRegistry deployed at ${instance.address}`)

}


async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)
    
    // streamr-docker-dev 
     
        await deployERC20JoinPolicyRegistry({
            permissions: [PermissionType.Publish, PermissionType.Subscribe],
            streamRegistryAddress: '0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222'
        })

    

    // Polygon Mainnet
    /*
    await deployERC20JoinPolicyRegistry({
            permissions: [PermissionType.Publish, PermissionType.Subscribe],
            streamRegistryAddress: '0x0D483E10612F327FC11965Fc82E90dC19b141641'
        })

*/
    

}

main()