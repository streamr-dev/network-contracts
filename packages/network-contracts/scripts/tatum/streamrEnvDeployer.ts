import { StreamrEnvDeployer } from "../../src/StreamrEnvDeployer"

async function main() {
    const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    const url = "http://127.0.0.1:8545"
    const streamrEnvDeployer = new StreamrEnvDeployer(key, url)
    await streamrEnvDeployer.deployEverything()
}

main()