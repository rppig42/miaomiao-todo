// 生成 App 图标和菜单栏图标：go run scripts/tools/make-icons.go
// App 图标来自 design/icon-source.png：缩进 macOS 图标的网格，切连续圆角，加投影。
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

func clamp(v float64) float64 { return math.Max(0, math.Min(1, v)) }

func segDist(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	t := clamp(((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy))
	return math.Hypot(px-ax-t*dx, py-ay-t*dy)
}

func roundRect(px, py, cx, cy, hw, hh, r float64) float64 {
	qx, qy := math.Abs(px-cx)-hw+r, math.Abs(py-cy)-hh+r
	return math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - r
}

func save(name string, img image.Image) {
	f, err := os.Create(name)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}

func load(name string) image.Image {
	f, err := os.Open(name)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		panic(err)
	}
	return img
}

// macOS 图标的网格：1024 的画布，图标本体 824，圆角 185.4。
const (
	canvas = 1024
	body   = 824
	margin = (canvas - body) / 2
	radius = 185.4
)

// insideBody 判断点在不在图标本体里。系统的圆角是连续曲线：
// 从直边过渡的地方就开始弯，弯的范围是半径的 1.53 倍，用指数 3.26 的超椭圆贴近，对角线上和普通圆角一样深。
func insideBody(px, py float64) bool {
	half := float64(body) / 2
	reach := 1.528665 * radius
	dx, dy := math.Abs(px-canvas/2), math.Abs(py-canvas/2)
	if dx > half || dy > half {
		return false
	}
	start := half - reach
	if dx <= start || dy <= start {
		return true
	}
	const n = 3.26
	return math.Pow((dx-start)/reach, n)+math.Pow((dy-start)/reach, n) <= 1
}

// sampleArea 把原图缩到本体大小。每个目标像素取一块区域的平均，缩小不会有锯齿。
func sampleArea(src image.Image, x, y int) (r, g, b float64) {
	const grid = 4
	bounds := src.Bounds()
	scale := float64(bounds.Dx()) / body
	for j := range grid {
		for i := range grid {
			sx := bounds.Min.X + int((float64(x)+(float64(i)+.5)/grid)*scale)
			sy := bounds.Min.Y + int((float64(y)+(float64(j)+.5)/grid)*scale)
			cr, cg, cb, _ := src.At(sx, sy).RGBA()
			r += float64(cr) / 257
			g += float64(cg) / 257
			b += float64(cb) / 257
		}
	}
	return r / (grid * grid), g / (grid * grid), b / (grid * grid)
}

func makeAppIcon() {
	src := load("design/icon-source.png")
	icon := image.NewNRGBA(image.Rect(0, 0, canvas, canvas))
	for y := range canvas {
		for x := range canvas {
			// 边缘抗锯齿。
			const aa = 4
			cover := 0.0
			for j := range aa {
				for i := range aa {
					if insideBody(float64(x)+(float64(i)+.5)/aa, float64(y)+(float64(j)+.5)/aa) {
						cover++
					}
				}
			}
			cover /= aa * aa

			// 本体下方一点柔和的投影，和其他 Mac App 的图标一样。
			d := roundRect(float64(x)+.5, float64(y)+.5, canvas/2, canvas/2+10, body/2, body/2, radius)
			shadow := 0.3 * math.Pow(clamp(1-d/26), 2)

			alpha := cover + (1-cover)*shadow
			if alpha == 0 {
				continue
			}
			var r, g, b float64
			if cover > 0 {
				sr, sg, sb := sampleArea(src, min(max(x-margin, 0), body-1), min(max(y-margin, 0), body-1))
				// 投影是黑色，只有本体贡献颜色。
				k := cover / alpha
				r, g, b = sr*k, sg*k, sb*k
			}
			icon.SetNRGBA(x, y, color.NRGBA{uint8(r + .5), uint8(g + .5), uint8(b + .5), uint8(alpha*255 + .5)})
		}
	}
	save("resources/icon.png", icon)
}

func makeTrayIcon() {
	// 菜单栏模板图：32×32 的圆角方框加对勾，只用透明度。
	tray := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := range 32 {
		for x := range 32 {
			px, py := float64(x)+.5, float64(y)+.5
			box := math.Abs(roundRect(px, py, 16, 16, 12, 12, 5)) - 1.3
			c := math.Min(segDist(px, py, 10.5, 16.5, 14.5, 20.5), segDist(px, py, 14.5, 20.5, 21.5, 11.5)) - 1.5
			a := clamp(.5 - math.Min(box, c))
			tray.SetNRGBA(x, y, color.NRGBA{0, 0, 0, uint8(a * 255)})
		}
	}
	save("resources/tray.png", tray)
}

func main() {
	makeAppIcon()
	makeTrayIcon()
}
