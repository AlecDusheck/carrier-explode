#!/usr/bin/env bash
# Rebuilds the product-partition fixtures from tree/: ext4 (inline data, an htree
# directory), EROFS plain, chunked and lz4. Needs e2fsprogs and erofs-utils.
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -r tree "$work/tree"
mkdir -p "$work/tree/many"
for i in $(seq -w 0 299); do : > "$work/tree/many/entry-$i"; done
python3 -c 'import sys; sys.stdout.buffer.write(bytes((i * 7 + i // 251) % 256 for i in range(10000)))' > "$work/tree/etc/CarrierSettings/filler.bin"
export E2FSPROGS_FAKE_TIME=1700000000 SOURCE_DATE_EPOCH=1700000000
mke2fs -q -F -t ext4 -b 4096 -N 512 -O inline_data,^has_journal,^resize_inode -E root_owner=0:0,hash_seed=00000000-0000-0000-0000-000000000001 \
  -U 00000000-0000-0000-0000-000000000002 -d "$work/tree" "$work/product.ext4" 2M
# -D re-indexes directories, which gives many/ an htree.
e2fsck -fyD "$work/product.ext4" > /dev/null || [ $? -le 1 ]
erofs() { mkfs.erofs --quiet -b 4096 -T 1700000000 -U "00000000-0000-0000-0000-00000000000$1" --all-root "${@:3}" "$work/$2" "$work/tree"; }
erofs 3 product.erofs
erofs 4 product-chunked.erofs --chunksize=4096
erofs 5 product-lz4.erofs -zlz4
for f in product.ext4 product.erofs product-chunked.erofs product-lz4.erofs; do gzip -9n < "$work/$f" > "$f.gz"; done
