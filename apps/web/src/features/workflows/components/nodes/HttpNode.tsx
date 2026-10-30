import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

import type { EditorNode } from '../../types';
import BaseNode from './BaseNode';

function HttpNode(props: NodeProps<EditorNode>) {
  return <BaseNode {...props} />;
}

export default memo(HttpNode);
