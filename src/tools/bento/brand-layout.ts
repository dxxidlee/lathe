/* Convert a BrandSlide into a Deck Slide. The brand slide keeps its own pixel-precise layout
   (22 slots at 1920×1080) and is rendered via renderSlideDOM, bypassing the 12×8 grid. */
import type { BrandSlide } from '../audit/brand-slide';
import { uid, type Slide } from './model';

export function brandSlideToDecSlide(slide: BrandSlide): Slide {
  return { id: uid('s'), tiles: [], variant: slide.variant, brand: slide };
}
