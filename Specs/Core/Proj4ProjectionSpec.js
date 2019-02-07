defineSuite([
    'Core/Proj4Projection',
    'Core/Cartesian3',
    'Core/Cartographic',
    'Core/Ellipsoid',
    'Core/Math',
    'Core/Rectangle'
], function(
    Proj4Projection,
    Cartesian3,
    Cartographic,
    Ellipsoid,
    CesiumMath,
    Rectangle) {
    'use strict';

    var mollweideWellKnownText = '+proj=moll +lon_0=0 +x_0=0 +y_0=0 +a=6371000 +b=6371000 +units=m +no_defs';
    var webMercatorWellKnownText = '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs';
    var westernHemisphere = Rectangle.fromDegrees(-180, -90, 0, 90);

    it('throws without wellKnownText', function() {
        expect(function() {
            return new Proj4Projection();
        }).toThrowDeveloperError();
    });

    it('construct0', function() {
        var projection = new Proj4Projection({
            wellKnownText : mollweideWellKnownText
        });
        expect(projection.wellKnownText).toEqual(mollweideWellKnownText);
        expect(projection.ellipsoid).toEqual(Ellipsoid.WGS84);
        expect(projection.heightScale).toEqual(1.0);
        expect(projection.wgs84Bounds).toEqual(Rectangle.MAX_VALUE);
    });

    it('construct1', function() {
        var projection = new Proj4Projection({
            wellKnownText : mollweideWellKnownText,
            wgs84Bounds : westernHemisphere
        });
        expect(projection.wellKnownText).toEqual(mollweideWellKnownText);
        expect(projection.ellipsoid).toEqual(Ellipsoid.WGS84);
        expect(projection.heightScale).toEqual(1.0);
        expect(projection.wgs84Bounds).toEqual(westernHemisphere);
    });

    it('construct2', function() {
        var projection = new Proj4Projection({
            wellKnownText : mollweideWellKnownText,
            wgs84Bounds : westernHemisphere,
            heightScale : 0.5
        });
        expect(projection.wellKnownText).toEqual(mollweideWellKnownText);
        expect(projection.ellipsoid).toEqual(Ellipsoid.WGS84);
        expect(projection.heightScale).toEqual(0.5);
        expect(projection.wgs84Bounds).toEqual(westernHemisphere);
    });

    it('project0', function() {
        var height = 10.0;
        var cartographic = new Cartographic(0.0, 0.0, height);
        var projection = new Proj4Projection({
            wellKnownText : mollweideWellKnownText
        });
        expect(projection.project(cartographic)).toEqual(new Cartesian3(0.0, 0.0, height));
    });

    it('project1', function() {
        var ellipsoid = Ellipsoid.WGS84;
        var cartographic = new Cartographic(Math.PI, CesiumMath.PI_OVER_FOUR, 0.0);

        // expected equations from Wolfram MathWorld:
        // http://mathworld.wolfram.com/MercatorProjection.html
        var expected = new Cartesian3(
                ellipsoid.maximumRadius * cartographic.longitude,
                ellipsoid.maximumRadius * Math.log(Math.tan(Math.PI / 4.0 + cartographic.latitude / 2.0)),
                0.0);

        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        expect(projection.project(cartographic)).toEqualEpsilon(expected, CesiumMath.EPSILON8);
    });

    it('project2', function() {
        var ellipsoid = Ellipsoid.WGS84;
        var cartographic = new Cartographic(-Math.PI, CesiumMath.PI_OVER_FOUR, 0.0);

        // expected equations from Wolfram MathWorld:
        // http://mathworld.wolfram.com/MercatorProjection.html
        var expected = new Cartesian3(
                ellipsoid.maximumRadius * cartographic.longitude,
                ellipsoid.maximumRadius * Math.log(Math.tan(Math.PI / 4.0 + cartographic.latitude / 2.0)),
                0.0);

        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        expect(projection.project(cartographic)).toEqualEpsilon(expected, CesiumMath.EPSILON8);
    });

    it('project3', function() {
        var ellipsoid = Ellipsoid.WGS84;
        var cartographic = new Cartographic(Math.PI, CesiumMath.PI_OVER_FOUR, 0.0);

        // expected equations from Wolfram MathWorld:
        // http://mathworld.wolfram.com/MercatorProjection.html
        var expected = new Cartesian3(
                ellipsoid.maximumRadius * cartographic.longitude,
                ellipsoid.maximumRadius * Math.log(Math.tan(Math.PI / 4.0 + cartographic.latitude / 2.0)),
                0.0);

        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        var result = new Cartesian3(0.0, 0.0, 0.0);
        var returnValue = projection.project(cartographic, result);
        expect(result).toEqual(returnValue);
        expect(result).toEqualEpsilon(expected, CesiumMath.EPSILON8);
    });

    it('unproject0', function() {
        var cartographic = new Cartographic(CesiumMath.PI_OVER_TWO, CesiumMath.PI_OVER_FOUR, 12.0);
        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        var projected = projection.project(cartographic);
        expect(projection.unproject(projected)).toEqualEpsilon(cartographic, CesiumMath.EPSILON14);
    });

    it('unproject1', function() {
        var cartographic = new Cartographic(CesiumMath.PI_OVER_TWO, CesiumMath.PI_OVER_FOUR, 12.0);
        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        var projected = projection.project(cartographic);
        var result = new Cartographic(0.0, 0.0, 0.0);
        var returnValue = projection.unproject(projected, result);
        expect(result).toEqual(returnValue);
        expect(result).toEqualEpsilon(cartographic, CesiumMath.EPSILON14);
    });

    it('scales height', function() {
        var ellipsoid = Ellipsoid.WGS84;
        var cartographic = new Cartographic(Math.PI, CesiumMath.PI_OVER_FOUR, 1.0);

        // expected equations from Wolfram MathWorld:
        // http://mathworld.wolfram.com/MercatorProjection.html
        var expected = new Cartesian3(
                ellipsoid.maximumRadius * cartographic.longitude,
                ellipsoid.maximumRadius * Math.log(Math.tan(Math.PI / 4.0 + cartographic.latitude / 2.0)),
                0.5);

        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText,
            heightScale : 0.5
        });
        var returnValue = projection.project(cartographic);
        expect(returnValue).toEqualEpsilon(expected, CesiumMath.EPSILON8);

        var unprojected = projection.unproject(returnValue);
        expect(unprojected).toEqualEpsilon(cartographic, CesiumMath.EPSILON8);
    });

    it('clamps cartographic coordinates to the specified wgs84 bounds', function() {
        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText,
            heightScale : 0.5,
            wgs84Bounds : Rectangle.fromDegrees(-180, -90, 180, 45)
        });
        var edgeProjected = projection.project(Cartographic.fromDegrees(0, 45, 0));
        var clampedProjected = projection.project(Cartographic.fromDegrees(0, 50, 0));

        expect(edgeProjected).toEqualEpsilon(clampedProjected, CesiumMath.EPSILON8);
    });

    it('project throws without cartesian', function() {
        var projection = new Proj4Projection({
            wellKnownText : webMercatorWellKnownText
        });
        expect(function() {
            return projection.unproject();
        }).toThrowDeveloperError();
    });
});
