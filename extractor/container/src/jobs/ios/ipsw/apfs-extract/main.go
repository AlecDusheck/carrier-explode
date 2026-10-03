// apfs-extract copies directories out of a raw APFS image, with no FUSE and
// no mount: Cloudflare Containers allow neither. It is go-apfs's `apfs cp`
// for a raw container (an IPSW's decrypted .dmg.aea is one), which the
// upstream CLI cannot open: it only takes UDIF images.
//
//	apfs-extract IMAGE SRC DEST [SRC DEST]...
//
// Each SRC is a directory inside the image; its contents land in DEST. A SRC
// the image lacks is an error: the caller asked for it because it expects it.
package main

import (
	"fmt"
	"os"

	"github.com/blacktop/go-apfs"
)

func main() {
	if len(os.Args) < 4 || len(os.Args)%2 != 0 {
		fmt.Fprintln(os.Stderr, "usage: apfs-extract IMAGE SRC DEST [SRC DEST]...")
		os.Exit(2)
	}
	if err := run(os.Args[1], os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "apfs-extract:", err)
		os.Exit(1)
	}
}

func run(image string, pairs []string) error {
	fs, err := apfs.Open(image)
	if err != nil {
		return fmt.Errorf("open %s: %w", image, err)
	}
	defer fs.Close()
	for i := 0; i < len(pairs); i += 2 {
		if err := fs.Copy(pairs[i], pairs[i+1]); err != nil {
			return fmt.Errorf("copy %q: %w", pairs[i], err)
		}
	}
	return nil
}
