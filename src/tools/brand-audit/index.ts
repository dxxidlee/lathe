import type { LatheTool } from '../types';
import { defaults } from './defaults';
import { mountBrand } from '../audit/brand';
import '../audit/audit.css';

export const tool: LatheTool = {
  id: 'brand-audit',
  name: 'Brand Audit',
  group: 'Workbench',
  defaults,
  mount(ctx) { return mountBrand(ctx); },
};
