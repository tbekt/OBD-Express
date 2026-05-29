import { Router } from 'express';
import pages      from './pages';
import ports      from './ports';
import connection from './connection';
import session    from './session';
import dtcs       from './dtcs';
import vehicle    from './vehicle';

const router = Router();

router.use(pages);
router.use(ports);
router.use(connection);
router.use(session);
router.use(dtcs);
router.use(vehicle);

export default router;
