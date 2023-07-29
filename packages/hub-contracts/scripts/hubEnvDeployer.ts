import { HubEnvDeployer } from "../src/HubEnvDeployer"

async function main() {
    // sidechain key preloaded with ETH (from docker-dev-init)
    const key = "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285"
    const url = "http://10.200.10.1:8546"
    const streamRegistryAddress = "0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222"
    const destinationDomainId = 8997

    const hubEnvDeployer = new HubEnvDeployer(
        key,
        url,
        streamRegistryAddress,
        destinationDomainId
    )

    await hubEnvDeployer.deployCoreContracts()
}

main()
