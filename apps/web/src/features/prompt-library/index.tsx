import PageHeader from '@/shared/components/PageHeader';
import { ComingSoon } from '@/shared/components/ui';

export default function PromptLibraryPage() {
  return (
    <div>
      <PageHeader title="Prompt Library" description="沉淀团队可复用的 System Prompt 与输出格式" />
      <ComingSoon
        title="Prompt Library 正在建设中"
        description="这里将支持 Prompt 的收藏、复用、版本与效果统计。当前页面为原型占位。"
        notes={['Prompt 收藏', '复用与版本', '效果统计']}
      />
    </div>
  );
}
