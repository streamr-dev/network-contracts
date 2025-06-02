# Peaq deployment notes

Addresses for the implementation contracts as of 2025-05-28:
```json
{
      "StreamRegistry": "0x3a9A81d576d83FF21f26f325066054540720fC34",
      "StreamRegistry proxy": "0xD0C720e99Bd39311614f292d8B0B4e351Bde157c",
      "ENSCacheV2": "0xcda36b4a69f4349052d995d2d8b4f3e8a70aa3af",
      "ENSCacheV2 proxy": "0x4A71d0FA9e3326E830048B1423d7010fB9343071",
      "StreamStorageRegistry": "0x5ABD469031d2B5f939808565EAB8562d7Cbaa939",
      "StreamStorageRegistry proxy": "0xB36CF8ee4219a3Ac9FBC3865C35E9a99353c26db",
      "StorageNodeRegistry proxy???": "0xaCF9e8134047eDc671162D9404BF63a587435bAa",
      "StreamrConfig": "0xFCE1FBFAaE61861B011B379442c8eE1DC868ABd0",
      "StreamrConfig proxy": "0xc81Fa3Cc3E81dF24D21bfc608f8FB06262Da4F8c"
}
```
the addresses marked "proxy" are the ones found in config.json because the implementations are used via those proxies.

The `StorageNodeRegistry` is a guess; in deployStreamrContracts.ts, it's deployed as a proxy, but in block explorer only one contract showed up. Not sure what's up with that.

## StreamRegistry issue fixed in 2025-05-30

Before the fix:
```
$ CHAIN=peaq STREAM_ID=0xc0147a6a8e21be06edb0703b008f0e732ceea531/peaq/DePIN_1 USER_ID=0xc0147a6a8e21be06edb0703b008f0e732ceea531 SCRIPT_FILE=scripts/check.ts npm run hardhatScript
...
Checking ENS (cache/bridge) state
Checking the network setup: { chainId: 3338, name: 'unknown' }
StreamRegistry contract at: 0xD0C720e99Bd39311614f292d8B0B4e351Bde157c (true)
ENSCacheV2 contract at: 0x4A71d0FA9e3326E830048B1423d7010fB9343071 (0x0000000000000000000000000000000000000000)
Checking stream '0xc0147a6a8e21be06edb0703b008f0e732ceea531/peaq/DePIN_1'
  Metadata: {"partitions":1}
User ID bytes: 0x000000000000000000000000c0147a6a8e21be06edb0703b008f0e732ceea531
  0xc0147a6a8e21be06edb0703b008f0e732ceea531 permissions: [ 'grant', 'edit', 'delete', 'publish', 'subscribe', [length]: 5 ]
  0xc0147a6a8e21be06edb0703b008f0e732ceea531 permissions: [ [length]: 0 ]
```

After the fix:
```
Checking stream '0xc0147a6a8e21be06edb0703b008f0e732ceea531/peaq/DePIN_1'
  Metadata: {"partitions":1}
  0xc0147a6a8e21be06edb0703b008f0e732ceea531 permissions: [ 'grant', 'edit', 'delete', 'publish', 'subscribe', [length]: 5 ]
  0xc0147a6a8e21be06edb0703b008f0e732ceea531 permissions: [ 'grant', 'edit', 'delete', 'publish', 'subscribe', [length]: 5 ]
```
