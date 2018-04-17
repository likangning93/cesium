define([
        './Cartesian3',
        './Check',
        './defined',
        './Quaternion',
        './Matrix4',
        './Matrix3',
        './Math',
        './JulianDate',
        './TranslationRotationScale',
        '../Scene/Model'
    ], function(
        Cartesian3,
        Check,
        defined,
        Quaternion,
        Matrix4,
        Matrix3,
        CesiumMath,
        JulianDate,
        TranslationRotationScale,
        Model
    ) {
    'use strict';

    // some constants and keys
    var frontTireNodeNames = ['Tire_3', 'Tire_4'];
    var rearTireNodeNames = ['Tire', 'Tire_2'];
    var tireRadius = 0.37;
    var tireCircumference = CesiumMath.TWO_PI * tireRadius;
    var distanceToRotation = CesiumMath.TWO_PI / tireCircumference;
    var frontWheelOffset = new Cartesian3(3.75, 0.0, 0.0);
    var centerOffset = new Cartesian3(2.0, 0.0, 5.0);

    function CarController(scene, carEntity) {
        this.carEntity = carEntity;

        this.currentPosition = new Cartesian3();
        this.previousPosition = new Cartesian3();
        this.previousTime = new JulianDate();

        this.frontLeftWheel = undefined;
        this.frontRightWheel = undefined;
        this.backLeftWheel = undefined;
        this.backRightWheel = undefined;

        this.currentFrontAxlePosition = new Cartesian3();
        this.previousFrontAxlePosition = new Cartesian3();

        this.originalFrontLeftModelMatrix = new Matrix4();
        this.originalFrontRightModelMatrix = new Matrix4();

        this.leftWheelAccumulatedRotation = Matrix4.clone(Matrix4.IDENTITY); // because front wheels can't accumulate rotation otherwise
        this.rightWheelAccumulatedRotation = Matrix4.clone(Matrix4.IDENTITY);

        this.ready = false;

        addEventListener(scene, this);
    }

    var modelMatrixScratch = new Matrix4();
    function computePositionAtTime(time, entity, result) {
        var modelMatrix = entity.computeModelMatrix(time, modelMatrixScratch);
        if (!defined(modelMatrix)) {
            return undefined;
        }
        return Matrix4.multiplyByPoint(modelMatrix, centerOffset, result);
    }

    var wheelRotationQuaternion = new Quaternion();
    var rotationMatrixScratch = new Matrix3();
    var rotationMatrix4Scratch = new Matrix4();

    var backLeftWheelScratch = new Matrix4();
    var backRightWheelScratch = new Matrix4();

    var offsetScratch = new Cartesian3();
    var directionScratch = new Cartesian3();
    var inverseModelMatrixScratch = new Matrix4();

    var turnQuaternionScratch = new Quaternion();
    var turnMatrix3Scratch = new Matrix3();
    var turnMatrix4Scratch = new Matrix4();
    function update(carController, time) {
        var carEntity = carController.carEntity;
        var currentPosition = carController.currentPosition;
        var previousPosition = carController.previousPosition;
        var previousTime = carController.previousTime;
        var currentFrontAxlePosition = carController.currentFrontAxlePosition;
        var previousFrontAxlePosition = carController.previousFrontAxlePosition;
        var backRightWheel = carController.backRightWheel;
        var backLeftWheel = carController.backLeftWheel;
        var frontLeftWheel = carController.frontLeftWheel;
        var frontRightWheel = carController.frontRightWheel;
        var leftWheelAccumulatedRotation = carController.leftWheelAccumulatedRotation;
        var rightWheelAccumulatedRotation = carController.rightWheelAccumulatedRotation;

        currentPosition = computePositionAtTime(time, carEntity, currentPosition);

        // If there hasn't been any movement, don't update wheels
        if (Cartesian3.equalsEpsilon(currentPosition, previousPosition, CesiumMath.EPSILON7)) {
            return;
        }

        var distanceTravelled = Cartesian3.distance(previousPosition, currentPosition);

        var rotationAngle = distanceTravelled * distanceToRotation;

        // Apply incremental rotation to each tire
        Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, rotationAngle, wheelRotationQuaternion);
        var rotationMatrix = Matrix3.fromQuaternion(wheelRotationQuaternion, rotationMatrixScratch);
        var rotationMatrix4 = Matrix4.fromRotationTranslation(rotationMatrix, Cartesian3.ZERO, rotationMatrix4Scratch);
        backRightWheel.matrix = Matrix4.multiply(backRightWheel.matrix, rotationMatrix4, backRightWheelScratch);
        rightWheelAccumulatedRotation = Matrix4.multiply(rightWheelAccumulatedRotation, rotationMatrix4, rightWheelAccumulatedRotation);

        Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, -rotationAngle, wheelRotationQuaternion);
        rotationMatrix = Matrix3.fromQuaternion(wheelRotationQuaternion, rotationMatrixScratch);
        rotationMatrix4 = Matrix4.fromRotationTranslation(rotationMatrix, Cartesian3.ZERO, rotationMatrix4Scratch);

        backLeftWheel.matrix = Matrix4.multiply(backLeftWheel.matrix, rotationMatrix4, backLeftWheelScratch);
        leftWheelAccumulatedRotation = Matrix4.multiply(leftWheelAccumulatedRotation, rotationMatrix4, leftWheelAccumulatedRotation);

        // Computing the front/back wheel "turn:"
        // - compute "before" and "current" positions for the wheels in world space
        // - compute angle in local space to align with vector from before pt -> current pt
        // - this is a multiply that goes on the incremental rotation
        var modelMatrix = carEntity.computeModelMatrix(time, modelMatrixScratch); // TODO: ughh
        var offsetWC = Matrix4.multiplyByPointAsVector(modelMatrix, frontWheelOffset, offsetScratch);
        currentFrontAxlePosition = Cartesian3.add(currentPosition, offsetWC, currentFrontAxlePosition);

        var wheelDirectionWC = Cartesian3.subtract(currentFrontAxlePosition, previousFrontAxlePosition, directionScratch);

        // Transform direction to local coordinates and come up with a rotation to match
        var inverseModelMatrix = Matrix4.inverse(modelMatrix, inverseModelMatrixScratch);
        var wheelDirectionMC = Matrix4.multiplyByPointAsVector(inverseModelMatrix, wheelDirectionWC, directionScratch);
        wheelDirectionMC = Cartesian3.normalize(wheelDirectionMC, wheelDirectionMC);
        var angle = -Math.acos(wheelDirectionMC.y) + CesiumMath.PI_OVER_TWO; // SHAME. SHAME. SHAME. *ding a ling a ling*
        var turnQuaternion = Quaternion.fromAxisAngle(Cartesian3.UNIT_Y, angle, turnQuaternionScratch);
        var turnMatrix3 = Matrix3.fromQuaternion(turnQuaternion, turnMatrix3Scratch);
        var turnMatrix4 = Matrix4.fromRotationTranslation(turnMatrix3, Cartesian3.ZERO, turnMatrix4Scratch);

        // Rotate, then turn
        var turnedRotated = Matrix4.multiply(turnMatrix4, leftWheelAccumulatedRotation, turnMatrix4);
        frontLeftWheel.matrix = Matrix4.multiply(carController.originalFrontLeftModelMatrix, turnedRotated, turnMatrix4);

        turnMatrix4 = Matrix4.fromRotationTranslation(turnMatrix3, Cartesian3.ZERO, turnMatrix4Scratch);

        // Rotate, then turn
        turnedRotated = Matrix4.multiply(turnMatrix4, rightWheelAccumulatedRotation, turnMatrix4);
        frontRightWheel.matrix = Matrix4.multiply(carController.originalFrontRightModelMatrix, turnedRotated, turnMatrix4);

        Cartesian3.clone(currentFrontAxlePosition, previousFrontAxlePosition);
        Cartesian3.clone(currentPosition, previousPosition);
        JulianDate.clone(time, previousTime);
    }

    // TODO: this is really, REALLY bad. probably.
    function setup(scene, carController) {
        var primitiveCount = scene.primitives.length;
        for (var i = 0; i < primitiveCount; i++) {
            var candidateModel = scene.primitives.get(i);
            if (defined(candidateModel.id) && candidateModel.id === carController.carEntity && candidateModel.ready) {
                var frontLeftWheel = candidateModel.getNode(frontTireNodeNames[0]);
                var frontRightWheel = candidateModel.getNode(frontTireNodeNames[1]);
                var backLeftWheel = candidateModel.getNode(rearTireNodeNames[0]);
                var backRightWheel = candidateModel.getNode(rearTireNodeNames[1]);

                frontLeftWheel.useMatrix = true;
                frontRightWheel.useMatrix = true;
                backLeftWheel.useMatrix = true;
                backRightWheel.useMatrix = true;

                carController.frontLeftWheel = frontLeftWheel;
                carController.frontRightWheel = frontRightWheel;
                carController.backLeftWheel = backLeftWheel;
                carController.backRightWheel = backRightWheel;

                carController.originalFrontLeftModelMatrix = Matrix4.clone(frontLeftWheel.matrix, carController.originalFrontLeftModelMatrix);
                carController.originalFrontRightModelMatrix = Matrix4.clone(frontRightWheel.matrix, carController.originalFrontRightModelMatrix);

                carController.ready = true;
                return;
            }
        }
    }

    function addEventListener(scene, carController) {
        scene.postRender.addEventListener(function(scene, time) {
            if (carController.ready) {
                update(carController, time);
            } else {
                setup(scene, carController);
            }
        });
    }

    return CarController;
});
