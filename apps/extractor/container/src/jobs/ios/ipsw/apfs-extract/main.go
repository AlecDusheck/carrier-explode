// apfs-extract copies directories out of an APFS image without FUSE or a mount:
// a UDIF .dmg (iOS 17 and older) or the raw container a .dmg.aea decrypts to.
//
//	apfs-extract IMAGE SRC DEST [SRC DEST]...
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/blacktop/go-apfs"
	"github.com/blacktop/go-apfs/pkg/disk"
	"github.com/blacktop/go-apfs/pkg/disk/dmg"
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

// isUDIF reports whether the image ends in a UDIF trailer ("koly").
func isUDIF(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return false, err
	}
	if st.Size() < 512 {
		return false, fmt.Errorf("%s: %d bytes is too small for an image", path, st.Size())
	}
	magic := make([]byte, 4)
	if _, err := f.ReadAt(magic, st.Size()-512); err != nil && err != io.EOF {
		return false, err
	}
	return string(magic) == "koly", nil
}

func open(path string) (disk.Device, error) {
	udif, err := isUDIF(path)
	if err != nil {
		return nil, err
	}
	if udif {
		return dmg.Open(path, &dmg.Config{DisableCache: true})
	}
	return disk.Open(path)
}

func run(image string, pairs []string) error {
	dev, err := open(image)
	if err != nil {
		return fmt.Errorf("open %s: %w", image, err)
	}
	defer dev.Close()
	fs, err := apfs.NewAPFS(dev)
	if err != nil {
		return fmt.Errorf("read APFS in %s: %w", image, err)
	}
	for i := 0; i < len(pairs); i += 2 {
		if err := fs.Copy(pairs[i], pairs[i+1]); err != nil {
			return fmt.Errorf("copy %q: %w", pairs[i], err)
		}
	}
	return nil
}
