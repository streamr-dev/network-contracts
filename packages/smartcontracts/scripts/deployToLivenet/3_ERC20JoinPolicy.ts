import { JsonRpcProvider } from '@ethersproject/providers'
import { constants, Contract, Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import hhat from 'hardhat'
const { ethers, upgrades } = hhat

// const TEST_TOKEN_ERC20_JOIN_POLICY_ADDRESS = '0xF2ffB432021ab887171BDf67fad054C5801a8dec'
const ERC20_TOKEN_POLYGON_ADDRESS = '0x06078ab1614c94B5101AB9412B06a183D16F191D'
const STREAM_REGISTRY_V3_ADDRESS = '0x0D483E10612F327FC11965Fc82E90dC19b141641'
const STREAM_ID = '0x734b1035c36202236b1c009efe2d5e27bed2ff9c/erc20-join-policy'


async function deployTestERC20(wallet: Wallet){
    const ERC20 = await ethers.getContractFactory('TestERC20', wallet)
    const token = await ERC20.deploy()
    console.log(`Deployed ERC20 token: ${token.address}`)
}

async function mintTestERC20(recipient: string, wallet: Wallet){
    const ERC20 = await ethers.getContractFactory('TestERC20', wallet)
    const token = ERC20.attach(ERC20_TOKEN_POLYGON_ADDRESS)
    const amount = parseEther('100')
    await token.mint(recipient, amount)
    console.log(`Minted ${amount} to ${recipient}`)
}
async function deployERC20JoinPolicy(wallet: Wallet) {
    const minRequiredBalance = parseEther('5')
    
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }


    const erc20JoinPolicyFactory = await ethers.getContractFactory('ERC20JoinPolicy', wallet)
    const erc20JoinPolicyFactoryTx = await erc20JoinPolicyFactory.deploy(
        ERC20_TOKEN_POLYGON_ADDRESS,
        STREAM_ID,
        STREAM_REGISTRY_V3_ADDRESS,
        [
            PermissionType.Publish, PermissionType.Subscribe
        ],
        minRequiredBalance)
    const erc20JoinPolicy = await erc20JoinPolicyFactoryTx.deployed()
    console.log(`ERC20JoinPolicy deployed at ${erc20JoinPolicy.address}`)
}

async function main(){
    const wallet = new Wallet('0xb4da2744047bddae80fc7a800268778171300ca8f9811573823d7958d9c53fe9')
    // await deployTestERC20()
    // await mintTestERC20(
    //     '0x008ef9bB0d80829ea82e53fFE40F35B4eaDd1319', // streamr test 2
    //     wallet
    // )

    await deployERC20JoinPolicy(wallet)
}

main()