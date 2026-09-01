import { Image, View, type ImageSourcePropType } from 'react-native';

import { boxToRect, type FlyerPage, type GeminiBox } from '@/api/extract';
import { colors } from '@/theme';

export function toImageSource(image: string | number): ImageSourcePropType {
  return typeof image === 'string' ? { uri: image } : image;
}

/**
 * Fit a page region (`rect`, in page pixels) into a `frameW`×`frameH` box:
 * the smallest scale that still covers the frame, positioned so the region is
 * centered, then clamped so the scaled page never exposes a frame edge.
 */
export function cropLayout(
  pageW: number,
  pageH: number,
  rect: { x: number; y: number; width: number; height: number },
  frameW: number,
  frameH: number,
) {
  const scale = Math.max(frameW / rect.width, frameH / rect.height);
  const imageW = pageW * scale;
  const imageH = pageH * scale;

  const centeredLeft = frameW / 2 - (rect.x + rect.width / 2) * scale;
  const centeredTop = frameH / 2 - (rect.y + rect.height / 2) * scale;

  return {
    imageW,
    imageH,
    left: clamp(centeredLeft, frameW - imageW, 0),
    top: clamp(centeredTop, frameH - imageH, 0),
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

type Props = {
  page: FlyerPage;
  box: GeminiBox | null;
  width: number;
  height: number;
};

/** Shows just the region of a flyer page inside `box` (no native cropper). */
export function CroppedFlyerImage({ page, box, width, height }: Props) {
  const rect = boxToRect(box, page.width, page.height, 6);

  if (!rect) {
    return <View style={{ width, height, backgroundColor: colors.border }} />;
  }

  const { imageW, imageH, left, top } = cropLayout(
    page.width,
    page.height,
    rect,
    width,
    height,
  );

  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
      <View style={{ position: 'absolute', left, top, width: imageW, height: imageH }}>
        <Image
          source={toImageSource(page.image)}
          style={{ width: '100%', height: '100%' }}
          resizeMode="stretch"
        />
      </View>
    </View>
  );
}
