import { PictureOutlined } from "@ant-design/icons";
import { Button, Input, Select, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type MenuItem = { label: string; href: string };

type LinkType = "page" | "blank" | "none";

type Banner = {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  action_label: string;
  link_type: LinkType;
  href: string;
  image_id: string | null;
  image_url: string | null;
  preview?: string;
};

type HomePage = {
  menu: MenuItem[];
  banners: Banner[];
};

const EMPTY_BANNER: Banner = { eyebrow: "", title: "", body: "", action_label: "", link_type: "page", href: "", image_id: null, image_url: null };

const LINK_TYPES = [
  { value: "page", label: "Trong trang" },
  { value: "blank", label: "Tab mới" },
  { value: "none", label: "Không chuyển" },
];

export function HomeBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draft = JSON.stringify({ menu, banners: banners.map(({ preview: _preview, ...item }) => item) });
  const dirty = draft !== baseline;

  const failAuth = useCallback(
    (caught: ApiError) => {
      if (caught.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (caught.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props.onUnauthorized, props.onMfaSetup],
  );

  const apply = useCallback((page: HomePage) => {
    const nextMenu = page.menu.map((item) => ({ label: item.label, href: item.href }));
    const nextBanners = page.banners.map((item) => ({
      id: item.id,
      eyebrow: item.eyebrow,
      title: item.title,
      body: item.body,
      action_label: item.action_label,
      link_type: item.link_type ?? "page",
      href: item.href,
      image_id: item.image_url ? item.id ?? null : null,
      image_url: item.image_url,
    }));
    setMenu(nextMenu);
    setBanners(nextBanners);
    setBaseline(JSON.stringify({ menu: nextMenu, banners: nextBanners }));
    setError(null);
  }, []);

  const load = useCallback(async () => {
    const page = await api<HomePage>("/api/v1/public/home");
    apply(page);
  }, [apply]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được trang chủ", "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [failAuth, load]);

  function changeMenu(next: MenuItem[]) {
    setNotice(null);
    setMenu(next);
  }

  function changeBanners(next: Banner[]) {
    setNotice(null);
    setBanners(next);
  }

  function updateMenu(index: number, patch: Partial<MenuItem>) {
    setNotice(null);
    setMenu((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function chooseBannerImage(index: number, file: File) {
    if (file.size === 0 || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      setError(new ApiError(400, "validation_error", "Chỉ gửi ảnh PNG, JPEG, WEBP hoặc GIF, tối đa 5 MB", ""));
      return;
    }
    setError(null);
    try {
      const saved = await api<{ image_id: string }>("/api/v1/admin/home/banners/images", { method: "POST", body: file });
      updateBanner(index, { image_id: saved.image_id, image_url: null, preview: URL.createObjectURL(file) });
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được ảnh banner", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  function updateBanner(index: number, patch: Partial<Banner>) {
    setNotice(null);
    setBanners((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const page = await api<HomePage>("/api/v1/admin/home", {
        method: "PUT",
        body: {
          menu: menu.map((item) => ({ label: item.label.trim(), href: item.href.trim() })),
          banners: banners.map((item) => ({
            eyebrow: item.eyebrow.trim(),
            title: item.title.trim(),
            body: item.body.trim(),
            action_label: item.action_label.trim(),
            link_type: item.link_type,
            href: item.link_type === "none" ? "" : item.href.trim(),
            image_id: item.image_id,
          })),
        },
      });
      apply(page);
      setNotice("Đã lưu menu và banner trang chủ.");
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được trang chủ", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Trang chủ
          </Typography.Title>
          <Typography.Text type="secondary">Menu và banner khuyến mãi hiện trên trang chủ chat. Thứ tự trong danh sách là thứ tự hiển thị.</Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            Lưu
          </Button>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      <div className="home-editor">
        <section>
          <header>
            <Typography.Title level={5}>Menu</Typography.Title>
            {props.canWrite ? (
              <Button size="small" disabled={loading || menu.length >= 12} onClick={() => changeMenu([...menu, { label: "", href: "/" }])}>
                Thêm mục
              </Button>
            ) : null}
          </header>
          {menu.length === 0 ? <Typography.Text type="secondary">Chưa có mục menu.</Typography.Text> : null}
          {menu.map((item, index) => (
            <article key={`menu-${index}`} className="home-row">
              <Input value={item.label} maxLength={40} placeholder="Tên mục" disabled={!props.canWrite || loading} onChange={(event) => updateMenu(index, { label: event.target.value })} />
              <Input value={item.href} maxLength={300} placeholder="/khuyen-mai hoặc https://" disabled={!props.canWrite || loading} onChange={(event) => updateMenu(index, { href: event.target.value })} />
              {props.canWrite ? (
                <div className="home-row__actions">
                  <Button size="small" disabled={index === 0} onClick={() => changeMenu(move(menu, index, -1))}>
                    Lên
                  </Button>
                  <Button size="small" disabled={index === menu.length - 1} onClick={() => changeMenu(move(menu, index, 1))}>
                    Xuống
                  </Button>
                  <Button size="small" danger onClick={() => changeMenu(menu.filter((_, itemIndex) => itemIndex !== index))}>
                    Xóa
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
        <section>
          <header>
            <Typography.Title level={5}>Banner khuyến mãi</Typography.Title>
            {props.canWrite ? (
              <Button size="small" disabled={loading || banners.length >= 8} onClick={() => changeBanners([...banners, { ...EMPTY_BANNER }])}>
                Thêm banner
              </Button>
            ) : null}
          </header>
          {banners.length === 0 ? <Typography.Text type="secondary">Chưa có banner.</Typography.Text> : null}
          {banners.map((item, index) => (
            <article key={`banner-${index}`} className="home-row home-row--banner">
              <Input value={item.eyebrow} maxLength={40} placeholder="Nhãn nhỏ" disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { eyebrow: event.target.value })} />
              <Input value={item.title} maxLength={120} placeholder="Tiêu đề" disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { title: event.target.value })} />
              <Input.TextArea value={item.body} maxLength={400} rows={2} placeholder="Nội dung" disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { body: event.target.value })} />
              <Input value={item.action_label} maxLength={40} placeholder="Chữ trên nút" disabled={!props.canWrite || loading} onChange={(event) => updateBanner(index, { action_label: event.target.value })} />
              <label className="home-field">
                <span>Kiểu chuyển hướng</span>
                <Select
                  value={item.link_type}
                  options={LINK_TYPES}
                  disabled={!props.canWrite || loading}
                  onChange={(value: LinkType) => updateBanner(index, { link_type: value, href: value === "none" ? "" : item.href })}
                />
              </label>
              {item.link_type !== "none" ? (
                <label className="home-field">
                  <span>Link chuyển hướng</span>
                  <Input
                    value={item.href}
                    maxLength={300}
                    placeholder={item.link_type === "blank" ? "https://" : "/khuyen-mai"}
                    disabled={!props.canWrite || loading}
                    onChange={(event) => updateBanner(index, { href: event.target.value })}
                  />
                </label>
              ) : null}
              <label className="home-field">
                <span>Ảnh banner</span>
                {bannerPreview(item) ? <img className="home-banner-preview" alt="" src={bannerPreview(item)} /> : <Typography.Text type="secondary">Chưa có ảnh</Typography.Text>}
                {props.canWrite ? (
                  <div className="home-banner-image">
                    <label className="chat-photo-send" title="Chọn ảnh banner" aria-label="Chọn ảnh banner">
                      <PictureOutlined />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={loading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) {
                            void chooseBannerImage(index, file);
                          }
                        }}
                      />
                    </label>
                    {item.image_id || item.preview ? (
                      <Button size="small" disabled={loading} onClick={() => updateBanner(index, { image_id: null, image_url: null, preview: undefined })}>
                        Gỡ ảnh
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </label>
              {props.canWrite ? (
                <div className="home-row__actions">
                  <Button size="small" disabled={index === 0} onClick={() => changeBanners(move(banners, index, -1))}>
                    Lên
                  </Button>
                  <Button size="small" disabled={index === banners.length - 1} onClick={() => changeBanners(move(banners, index, 1))}>
                    Xuống
                  </Button>
                  <Button size="small" danger onClick={() => changeBanners(banners.filter((_, itemIndex) => itemIndex !== index))}>
                    Xóa
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function bannerPreview(item: Banner): string {
  if (item.preview) {
    return item.preview;
  }
  return item.image_url ? toApiUrl(item.image_url) : "";
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  if (!item) {
    return items;
  }
  copy.splice(next, 0, item);
  return copy;
}
