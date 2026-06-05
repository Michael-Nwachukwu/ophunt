import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer style={{ background: '#fffaf0' }}>
      {/* Mountain illustration */}
      <div className="overflow-hidden" style={{ lineHeight: 0 }}>
        <svg
          viewBox="0 0 1440 120"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100px', display: 'block' }}
          aria-hidden="true"
        >
          <path
            d="M0,120 L0,95 C40,95 60,78 90,68 C120,58 145,65 170,55 C200,44 220,50 250,38 C280,26 308,33 340,28 C372,22 398,35 430,44 C462,54 488,48 518,34 C548,20 572,26 602,32 C632,38 658,36 688,22 C718,8 742,14 772,28 C802,42 828,40 858,52 C888,64 912,60 942,50 C972,40 998,46 1030,56 C1062,66 1088,62 1118,52 C1148,42 1172,50 1202,60 C1232,70 1258,66 1290,72 C1322,78 1348,74 1380,80 C1400,84 1420,86 1440,84 L1440,120 Z"
            fill="#f5ece0"
          />
          {/* Darker layer for depth */}
          <path
            d="M0,120 L0,108 C80,100 140,95 200,88 C260,81 300,85 360,80 C420,75 470,68 530,72 C590,76 640,82 700,78 C760,74 810,65 870,68 C930,71 980,79 1040,76 C1100,73 1150,66 1210,70 C1270,74 1330,82 1390,85 C1420,87 1435,88 1440,88 L1440,120 Z"
            fill="#eee3d0"
          />
        </svg>
      </div>

      {/* Footer content */}
      <div style={{ background: '#f5ece0', paddingBottom: '48px', paddingTop: '24px' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div>
              <p
                className="font-heading font-medium mb-2"
                style={{ fontSize: '22px', letterSpacing: '-0.5px', color: '#0a0a0a' }}
              >
                OpHunt
              </p>
              <p
                className="font-body text-sm max-w-sm"
                style={{ color: 'rgba(10,10,10,0.5)', lineHeight: '1.65' }}
              >
                OpHunt reads any page, surfaces buildable ideas, and hands you straight to a founder agent that ships them.
              </p>
            </div>

            <nav className="flex flex-col gap-3" aria-label="Footer navigation">
              <Link
                to="/explore"
                className="font-body text-sm no-underline hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(10,10,10,0.55)' }}
              >
                Explore Ideas
              </Link>
              <a
                href="#pricing"
                className="font-body text-sm no-underline hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(10,10,10,0.55)' }}
              >
                Pricing
              </a>
            </nav>
          </div>

          <div
            className="mt-10 pt-6 font-body text-xs"
            style={{ borderTop: '1px solid rgba(10,10,10,0.1)', color: 'rgba(10,10,10,0.35)' }}
          >
            © {new Date().getFullYear()} OpHunt. Reads the web so you can build it.
          </div>
        </div>
      </div>
    </footer>
  );
}