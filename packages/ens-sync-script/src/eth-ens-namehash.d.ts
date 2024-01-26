declare module "eth-ens-namehash" {
    export function hash(inputName: string): string;
    export function normalize(name: string): string;
}
