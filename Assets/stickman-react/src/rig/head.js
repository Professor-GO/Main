const HEAD_H = 140, CHIN_Y = 172;
/** SVG <image> props for a head picture {src,w,h}: fixed height, chin on the neck. */
export function headProps(img) {
  const w = (HEAD_H * img.w) / img.h;
  return { href: img.src, width: w, height: HEAD_H, x: 200 - w / 2, y: CHIN_Y - HEAD_H };
}
