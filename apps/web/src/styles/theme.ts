import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1F4E3D',
    colorInfo: '#2F7059',
    borderRadius: 10,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Layout: { headerBg: '#fff', siderBg: '#ffffff' },
    Menu: { itemBg: 'transparent', itemSelectedBg: '#edf3ef', itemSelectedColor: '#1F4E3D' },
  },
};
