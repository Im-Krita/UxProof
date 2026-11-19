from pathlib import Path
from PIL import Image
import qrcode

root = Path(__file__).resolve().parent / "assets"

def crop(src, box, dest):
    im = Image.open(root / src)
    w, h = im.size
    # box is fractions l,t,r,b
    l, t, r, b = box
    im.crop((int(w * l), int(h * t), int(w * r), int(h * b))).save(root / dest, "PNG")

# 2x screenshots 2880x1800
crop("ui-editor.png", (0.16, 0.0, 1.0, 1.0), "crop-editor.png")
crop("ui-results.png", (0.38, 0.12, 0.99, 0.96), "crop-results.png")
crop("ui-issue-modal.png", (0.22, 0.08, 0.78, 0.92), "crop-modal.png")
crop("ui-history.png", (0.0, 0.0, 0.42, 1.0), "crop-sidebar-history.png")
crop("live-settings-desktop.png", (0.12, 0.22, 0.88, 0.95), "crop-settings-desktop.png")
crop("live-settings-mobile.png", (0.0, 0.0, 1.0, 1.0), "crop-settings-mobile.png")
crop("live-settings-tablet.png", (0.08, 0.18, 0.92, 0.92), "crop-settings-tablet.png")
crop("live-fixed-settings-mobile.png", (0.0, 0.0, 1.0, 1.0), "crop-fixed-mobile.png")
crop("ui-recommendations.png", (0.38, 0.12, 0.99, 0.96), "crop-recommendations.png")
crop("run-settings-desktop.png", (0.0, 0.0, 1.0, 1.0), "audit-desktop.png")
crop("run-settings-tablet.png", (0.0, 0.0, 1.0, 1.0), "audit-tablet.png")
crop("run-settings-mobile.png", (0.0, 0.0, 1.0, 1.0), "audit-mobile.png")
crop("error-home-mobile.png", (0.0, 0.0, 1.0, 1.0), "audit-error-home.png")

qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=2)
qr.add_data("https://github.com/Narut0-1488/UXProof")
qr.make(fit=True)
img = qr.make_image(fill_color="#213E33", back_color="#FFFFFF")
img.save(root / "qr-github.png")
print("cropped")
