import type { LatheTool } from '../types';
import { defaults } from './defaults';
import { mountSubject } from '../audit/subject';
import '../audit/audit.css';

export const tool: LatheTool = {
  id: 'subject-audit',
  name: 'Subject Audit',
  group: 'Workbench',
  defaults,
  mount(ctx) { return mountSubject(ctx); },
};
