import { JsonRpcProvider } from "@ethersproject/providers"
import { BigNumber, Wallet } from "ethers"
import hhat from "hardhat"
const { ethers } = hhat
import axios from "axios"

// localsidechain
const chainURL = "http://10.200.10.1:8546"
const privKeyStreamRegistry = ""
let wallet: Wallet 

const DelegatedAccessRegistryAddress = "0x1CF4ee3a493f9B07AE9394F78E1407c2682B0e8C"

enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

async function getGasStationPrices(): Promise<{maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber}> {
    const { data } = await axios({
        method: "get",
        url: "https://gasstation-mainnet.matic.network/v2"
    })
    const maxFeePerGas = ethers.utils.parseUnits(
        Math.ceil(data.fast.maxFee) + "",
        "gwei"
    )
    const maxPriorityFeePerGas = ethers.utils.parseUnits(
        Math.ceil(data.fast.maxPriorityFee) + "",
        "gwei"
    )

    return { maxFeePerGas, maxPriorityFeePerGas }
}

async function deployJoinPolicyFactory({
    permissions, streamRegistryAddress
}: {
    permissions: PermissionType[],
    streamRegistryAddress: string,
}){
    const JoinPolicyFactory = await ethers.getContractFactory("JoinPolicyFactory", wallet)

    const { maxFeePerGas, maxPriorityFeePerGas } = await getGasStationPrices()

    const tx = await JoinPolicyFactory.deploy(
        streamRegistryAddress,
        permissions,
        DelegatedAccessRegistryAddress
        , {
            maxFeePerGas, maxPriorityFeePerGas
        })

    const instance = await tx.deployed()

    console.log(`JoinPolicyFactory deployed at ${instance.address}`)

}

async function main() {
    wallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))
    console.log(`wallet address ${wallet.address}`)
    // streamr-docker-dev 
    await deployJoinPolicyFactory({
        permissions: [PermissionType.Publish, PermissionType.Subscribe],
        streamRegistryAddress: "0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222"
    })
    /*
    // Polygon Mainnet
    await deployJoinPolicyFactory({
            permissions: [PermissionType.Publish, PermissionType.Subscribe],
            streamRegistryAddress: '0x0D483E10612F327FC11965Fc82E90dC19b141641'
        })
        */
}

main()
