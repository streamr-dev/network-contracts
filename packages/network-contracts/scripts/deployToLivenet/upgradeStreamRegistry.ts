import { ethers, upgrades } from "hardhat"
import { networks } from "@streamr/config"
import { parseUnits } from "ethers/lib/utils"

// Polygon mainet
const STREAMREGISTRYADDRESS = networks.polygon.contracts.StreamRegistry
const DEPLOYMENT_OWNER_KEY = process.env.OCR_ADMIN_PRIVATEKEY || ""

// localsidechain
// const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'
// const STREAMREGISTRYADDRESS = '0x9EffC9A884098180dE81B254e302DFE1598aE3AF'

async function main() {

    const deploymentOwner = new ethers.Wallet(DEPLOYMENT_OWNER_KEY, ethers.provider)
    deploymentOwner.getFeeData = async() => {
        console.log("##########################")
        return { maxFeePerGas: parseUnits("500", "gwei"), maxPriorityFeePerGas: parseUnits("1", "gwei"), gasPrice: parseUnits("200", "gwei") }
    }
    const streamregistryFactoryV4 = await ethers.getContractFactory("StreamRegistryV4", deploymentOwner)
    console.log("upgrading Streamregistry: proxyaddress: " + STREAMREGISTRYADDRESS)
    const streamRegistryUpgraded = await upgrades.upgradeProxy(STREAMREGISTRYADDRESS, streamregistryFactoryV4, {kind: "uups"})
    console.log("streamregistry upgraded, address is (should be same): " + streamRegistryUpgraded.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })

