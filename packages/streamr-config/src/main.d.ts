/// <reference path="index.d.ts" />
/// <reference path="Network.d.ts" />

declare module "./networks.json" {
    const networks: Map<string, Network>
    export default networks
}
