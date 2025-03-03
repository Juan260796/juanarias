package co.edu.uniquindio.Repaso.EstructurasDeControl;

import java.sql.SQLOutput;
import java.util.Scanner;

public class SwitchClass2 {
    public static void main(String[] args) {
        System.out.println("Ingrese un numero entre 1 y 7");
        Scanner sc= new Scanner(System.in);
        int dia= sc.nextInt();
        switch (dia){
            case 1:
                System.out.println("El dia de la semana es Domingo");
                break;
            case 2:
                System.out.println("El dia de la semana es lunes");
                break;
            case 3:
                System.out.println("EL dia de la semana es Martes");
                break;
            case 4:
                System.out.println("El dia de la semana es Miercoles");
                break;
            case 5:
                System.out.println("El dia de la semana es Jueves");
                break;
            case 6:
                System.out.println("El dia de la semana es Viernes");
                break;
            case 7:
                System.out.println("El dia de la seana es Sabado");
                break;
            default:
                System.out.println("El numero ingresado no es valido");
                break;

        }


    }
}
